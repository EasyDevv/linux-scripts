use anyhow::{Context, Result};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::time::Duration;

pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

pub trait Http {
    fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse>;
    fn post(&self, url: &str, headers: &[(&str, &str)], body: &str) -> Result<HttpResponse>;
}

pub struct ReqwestHttp {
    client: Client,
}

impl ReqwestHttp {
    pub fn with_timeout_ms(timeout_ms: u64) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .context("building HTTP client")?;
        Ok(Self { client })
    }
}

impl Http for ReqwestHttp {
    fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse> {
        let mut map = HeaderMap::new();
        for (name, value) in headers {
            let header_name = HeaderName::from_bytes(name.as_bytes())
                .with_context(|| format!("header name {name}"))?;
            let header_value = HeaderValue::from_str(value).context("header value")?;
            map.insert(header_name, header_value);
        }
        let response = self
            .client
            .get(url)
            .headers(map)
            .send()
            .with_context(|| format!("GET {url}"))?;
        let status = response.status().as_u16();
        let body = response.text().unwrap_or_default();
        Ok(HttpResponse { status, body })
    }

    fn post(&self, url: &str, headers: &[(&str, &str)], body: &str) -> Result<HttpResponse> {
        let mut map = HeaderMap::new();
        for (name, value) in headers {
            let header_name = HeaderName::from_bytes(name.as_bytes())
                .with_context(|| format!("header name {name}"))?;
            let header_value = HeaderValue::from_str(value).context("header value")?;
            map.insert(header_name, header_value);
        }
        let response = self
            .client
            .post(url)
            .headers(map)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .with_context(|| format!("POST {url}"))?;
        let status = response.status().as_u16();
        let body = response.text().unwrap_or_default();
        Ok(HttpResponse { status, body })
    }
}

#[cfg(test)]
pub struct MapHttp {
    pub routes: Vec<(String, u16, String)>,
}

#[cfg(test)]
impl Http for MapHttp {
    fn get(&self, url: &str, _headers: &[(&str, &str)]) -> Result<HttpResponse> {
        lookup(&self.routes, url)
    }

    fn post(&self, url: &str, _headers: &[(&str, &str)], _body: &str) -> Result<HttpResponse> {
        lookup(&self.routes, &format!("POST {url}"))
    }
}

#[cfg(test)]
fn lookup(routes: &[(String, u16, String)], url: &str) -> Result<HttpResponse> {
    for (pattern, status, body) in routes {
        if url == *pattern || url.contains(pattern) {
            return Ok(HttpResponse {
                status: *status,
                body: body.clone(),
            });
        }
    }
    Ok(HttpResponse {
        status: 404,
        body: String::new(),
    })
}
