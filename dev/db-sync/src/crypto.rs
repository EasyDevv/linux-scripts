use std::collections::HashMap;
use std::fs;
use std::path::Path;

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{bail, Context, Result};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;

const PREFIX: &str = "enc:v1:";

#[derive(Clone)]
pub struct DataKey {
    pub id: String,
    bytes: [u8; 32],
}

impl DataKey {
    pub fn from_base64(id: &str, encoded: &str) -> Result<Self> {
        if id.is_empty() || id.contains(':') {
            bail!("DATA_ENCRYPTION_KEY_ID must be non-empty and contain no colon");
        }
        let decoded = URL_SAFE_NO_PAD
            .decode(encoded.trim())
            .or_else(|_| STANDARD.decode(encoded.trim()))
            .context("DATA_ENCRYPTION_KEY must be base64")?;
        let bytes: [u8; 32] = decoded
            .try_into()
            .map_err(|_| anyhow::anyhow!("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes"))?;
        Ok(Self {
            id: id.to_string(),
            bytes,
        })
    }

    pub fn load_file(path: &Path) -> Result<Self> {
        let parsed = parse_env_file(path)?;
        let id = parsed
            .get("DATA_ENCRYPTION_KEY_ID")
            .cloned()
            .filter(|s| !s.is_empty())
            .with_context(|| format!("missing DATA_ENCRYPTION_KEY_ID in {}", path.display()))?;
        if let Some(encoded) = parsed
            .get("DATA_ENCRYPTION_KEY")
            .cloned()
            .filter(|s| !s.is_empty())
        {
            return Self::from_base64(&id, &encoded);
        }
        let file = parsed
            .get("DATA_ENCRYPTION_KEY_FILE")
            .cloned()
            .filter(|s| !s.is_empty())
            .with_context(|| {
                format!(
                    "missing DATA_ENCRYPTION_KEY or DATA_ENCRYPTION_KEY_FILE in {}",
                    path.display()
                )
            })?;
        let encoded = fs::read_to_string(&file)
            .with_context(|| format!("read DATA_ENCRYPTION_KEY_FILE {file}"))?;
        Self::from_base64(&id, encoded.trim())
    }
}

pub struct Keyring {
    ciphers: HashMap<String, Aes256Gcm>,
}

impl Keyring {
    pub fn new(keys: impl IntoIterator<Item = DataKey>) -> Result<Self> {
        let mut ciphers = HashMap::new();
        for key in keys {
            let cipher = Aes256Gcm::new_from_slice(&key.bytes)
                .map_err(|_| anyhow::anyhow!("invalid encryption key"))?;
            ciphers.insert(key.id, cipher);
        }
        if ciphers.is_empty() {
            bail!("no data encryption keys loaded");
        }
        Ok(Self { ciphers })
    }

    fn cipher(&self, id: &str) -> Result<&Aes256Gcm> {
        self.ciphers
            .get(id)
            .with_context(|| format!("encryption key {id} is unavailable"))
    }

    pub fn encrypt(
        &self,
        dest: &DataKey,
        table: &str,
        record_id: &str,
        field: &str,
        value: &str,
    ) -> Result<String> {
        if value.is_empty() {
            return Ok(String::new());
        }
        let cipher = self.cipher(&dest.id)?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let aad = aad(table, record_id, field);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: value.as_bytes(),
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| anyhow::anyhow!("sensitive data encryption failed"))?;
        Ok(format!(
            "{PREFIX}{}:{}:{}",
            dest.id,
            URL_SAFE_NO_PAD.encode(nonce),
            URL_SAFE_NO_PAD.encode(ciphertext)
        ))
    }

    pub fn decrypt(
        &self,
        table: &str,
        record_id: &str,
        field: &str,
        value: &str,
    ) -> Result<String> {
        if value.is_empty() {
            return Ok(String::new());
        }
        let encoded = value
            .strip_prefix(PREFIX)
            .with_context(|| format!("unencrypted sensitive value in {table}.{field}"))?;
        let mut parts = encoded.splitn(3, ':');
        let key_id = parts
            .next()
            .filter(|s| !s.is_empty())
            .context("ciphertext missing key id")?;
        let nonce = parts.next().context("ciphertext missing nonce")?;
        let ciphertext = parts.next().context("ciphertext missing body")?;
        let cipher = self.cipher(key_id)?;
        let nonce = URL_SAFE_NO_PAD
            .decode(nonce)
            .context("invalid nonce encoding")?;
        let nonce: [u8; 12] = nonce
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid nonce length"))?;
        let ciphertext = URL_SAFE_NO_PAD
            .decode(ciphertext)
            .context("invalid ciphertext encoding")?;
        let aad = aad(table, record_id, field);
        let plaintext = cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| anyhow::anyhow!("sensitive data authentication failed"))?;
        String::from_utf8(plaintext).context("sensitive data is not UTF-8")
    }

    pub fn toward_dest(
        &self,
        dest: &DataKey,
        table: &str,
        record_id: &str,
        field: &str,
        value: &str,
    ) -> Result<String> {
        if value.is_empty() {
            return Ok(String::new());
        }
        if let Some(id) = ciphertext_key_id(value) {
            if id == dest.id {
                return Ok(value.to_string());
            }
            let plaintext = self.decrypt(table, record_id, field, value)?;
            return self.encrypt(dest, table, record_id, field, &plaintext);
        }
        self.encrypt(dest, table, record_id, field, value)
    }

    pub fn plaintext(
        &self,
        table: &str,
        record_id: &str,
        field: &str,
        value: &str,
    ) -> Result<String> {
        if value.is_empty() {
            return Ok(String::new());
        }
        if ciphertext_key_id(value).is_some() {
            self.decrypt(table, record_id, field, value)
        } else {
            Ok(value.to_string())
        }
    }
}

fn aad(table: &str, record_id: &str, field: &str) -> String {
    format!("{table}|{record_id}|{field}|v1")
}

pub fn ciphertext_key_id(value: &str) -> Option<&str> {
    value.strip_prefix(PREFIX)?.split(':').next()
}

pub fn parse_env_file(path: &Path) -> Result<HashMap<String, String>> {
    let text = fs::read_to_string(path)
        .with_context(|| format!("read env file {}", path.display()))?;
    let mut out = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || !line.contains('=') {
            continue;
        }
        let (key, value) = line.split_once('=').expect("contains =");
        let mut value = value.trim().to_string();
        if (value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\''))
        {
            value = value[1..value.len() - 1].to_string();
        }
        out.insert(key.trim().to_string(), value);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    fn key(id: &str, fill: u8) -> DataKey {
        DataKey::from_base64(id, &URL_SAFE_NO_PAD.encode([fill; 32])).unwrap()
    }

    #[test]
    fn round_trip_and_reencrypt_changes_key_id() {
        let local = key("local", 3);
        let prod = key("prod", 7);
        let ring = Keyring::new([local.clone(), prod.clone()]).unwrap();
        let enc = ring
            .encrypt(&local, "prop_units", "u1", "memo", "secret")
            .unwrap();
        assert!(enc.starts_with("enc:v1:local:"));
        assert_eq!(
            ring.decrypt("prop_units", "u1", "memo", &enc).unwrap(),
            "secret"
        );
        let moved = ring
            .toward_dest(&prod, "prop_units", "u1", "memo", &enc)
            .unwrap();
        assert!(moved.starts_with("enc:v1:prod:"));
        assert_eq!(
            ring.decrypt("prop_units", "u1", "memo", &moved).unwrap(),
            "secret"
        );
    }

    #[test]
    fn toward_dest_leaves_matching_key() {
        let prod = key("prod", 7);
        let ring = Keyring::new([prod.clone()]).unwrap();
        let enc = ring
            .encrypt(&prod, "prop_units", "u1", "memo", "keep")
            .unwrap();
        assert_eq!(
            ring.toward_dest(&prod, "prop_units", "u1", "memo", &enc)
                .unwrap(),
            enc
        );
    }
}
