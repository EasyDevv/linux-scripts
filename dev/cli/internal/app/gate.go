// gate.go ports cli-rust/src/gate.rs.
//
// evaluate never touches the network. Callers pass the downloaded artifact
// and metadata. Order is cooldown, then checksum file (if present it must
// match), then signature (if present it must verify), then pinned sha256
// (if present it must match even when another check passed).
// A release with none of those is blocked. A vendor tool may ask for a pin.
// Io and Config are exit 1. Every other block is exit 2.

package app

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Level is the verification strength. Sig > Checksum > Pinned.
type Level int

const (
	LevelPinned Level = iota
	LevelChecksum
	LevelSig
)

// AsStr is Level::as_str.
func (l Level) AsStr() string {
	switch l {
	case LevelSig:
		return "sig"
	case LevelChecksum:
		return "checksum"
	case LevelPinned:
		return "pinned"
	default:
		return ""
	}
}

// Verified is the artifact hash and the level that allowed it.
type Verified struct {
	Level  Level
	SHA256 string
}

const (
	DecisionAllowed  = "allowed"
	DecisionNeedsPin = "needs_pin"
)

// Decision is Allowed(Verified) or NeedsPin { sha256 }.
// Kind is DecisionAllowed or DecisionNeedsPin. Level is set only for Allowed.
type Decision struct {
	Kind   string
	Level  Level
	SHA256 string
}

const (
	BlockedKindCooldown        = "Cooldown"
	BlockedKindPrerelease      = "Prerelease"
	BlockedKindHashMismatch    = "HashMismatch"
	BlockedKindChecksumMissing = "ChecksumMissing"
	BlockedKindSig             = "Sig"
	BlockedKindHost            = "Host"
	BlockedKindNoVerification  = "NoVerification"
	BlockedKindConfig          = "Config"
	BlockedKindIo              = "Io"
)

// Blocked is gate::Blocked. Error text matches Rust Display.
// Cooldown, Hash, Sig, and Host point at the inner error.
// Version is the prerelease. Asset is the missing checksum name.
// Message is Config or Io text.
type Blocked struct {
	Kind     string
	Cooldown *CooldownViolation
	Version  string
	Hash     *ChecksumMismatch
	Asset    string
	Sig      *GpgError
	Host     *HostBlocked
	Message  string
}

// Error is Display for Blocked.
func (b *Blocked) Error() string {
	if b == nil {
		return ""
	}
	switch b.Kind {
	case BlockedKindCooldown:
		if b.Cooldown == nil {
			return ""
		}
		return b.Cooldown.Error()
	case BlockedKindPrerelease:
		return fmt.Sprintf("prerelease 버전은 설치하지 않습니다: %s (정식 버전을 지정하세요)", b.Version)
	case BlockedKindHashMismatch:
		if b.Hash == nil {
			return "checksum mismatch: expected , got "
		}
		return b.Hash.Error()
	case BlockedKindChecksumMissing:
		return fmt.Sprintf("checksum file has no entry for %s", b.Asset)
	case BlockedKindSig:
		if b.Sig == nil {
			return ""
		}
		return b.Sig.Error()
	case BlockedKindHost:
		if b.Host == nil {
			return " ()"
		}
		return fmt.Sprintf("%s (%s)", b.Host.URL, b.Host.Reason)
	case BlockedKindNoVerification:
		return "no checksum, signature or pinned sha256 available"
	case BlockedKindConfig, BlockedKindIo:
		return b.Message
	default:
		return "blocked"
	}
}

// Unwrap exposes the inner cooldown, checksum, signature, or host error.
func (b *Blocked) Unwrap() error {
	if b == nil {
		return nil
	}
	switch b.Kind {
	case BlockedKindCooldown:
		return b.Cooldown
	case BlockedKindHashMismatch:
		if b.Hash == nil {
			return nil
		}
		return b.Hash
	case BlockedKindSig:
		return b.Sig
	case BlockedKindHost:
		return b.Host
	default:
		return nil
	}
}

// ExitCode is Blocked::exit_code. Io and Config are ExitError. Everything else is ExitBlocked.
func (b *Blocked) ExitCode() int {
	if b == nil {
		return ExitError
	}
	if b.Kind == BlockedKindIo || b.Kind == BlockedKindConfig {
		return ExitError
	}
	return ExitBlocked
}

func gateBlocked(b *Blocked) error {
	if b == nil {
		b = &Blocked{Kind: BlockedKindNoVerification}
	}
	return &BlockedError{Err: b, Code: b.ExitCode()}
}

// blockedFromCooldown is From<CooldownViolation> for Blocked.
func blockedFromCooldown(value *CooldownViolation) error {
	return gateBlocked(&Blocked{Kind: BlockedKindCooldown, Cooldown: value})
}

// blockedPrerelease is Blocked::Prerelease. Exit code is 2.
func blockedPrerelease(version string) error {
	return gateBlocked(&Blocked{Kind: BlockedKindPrerelease, Version: version})
}

func blockedHash(err error) error {
	var mismatch ChecksumMismatch
	if errors.As(err, &mismatch) {
		copied := mismatch
		return gateBlocked(&Blocked{Kind: BlockedKindHashMismatch, Hash: &copied})
	}
	return gateBlocked(&Blocked{
		Kind: BlockedKindHashMismatch,
		Hash: &ChecksumMismatch{Actual: err.Error()},
	})
}

func blockedChecksumMissing(asset string) error {
	return gateBlocked(&Blocked{Kind: BlockedKindChecksumMissing, Asset: asset})
}

func blockedSig(err error) error {
	var gpg *GpgError
	if errors.As(err, &gpg) {
		return gateBlocked(&Blocked{Kind: BlockedKindSig, Sig: gpg})
	}
	return gateBlocked(&Blocked{
		Kind: BlockedKindSig,
		Sig:  &GpgError{Kind: GpgKindBadSignature, Message: err.Error()},
	})
}

// blockedFromHost is From<HostBlocked> for Blocked. Exit code is 2.
// Display is "{url} ({reason})", not HostBlocked.Error().
func blockedFromHost(value *HostBlocked) error {
	return gateBlocked(&Blocked{Kind: BlockedKindHost, Host: value})
}

func blockedNoVerification() error {
	return gateBlocked(&Blocked{Kind: BlockedKindNoVerification})
}

func blockedConfig(message string) error {
	return gateBlocked(&Blocked{Kind: BlockedKindConfig, Message: message})
}

func blockedIo(message string) error {
	return gateBlocked(&Blocked{Kind: BlockedKindIo, Message: message})
}

// SigCovers is what the signature covers. Release signs the checksum file.
// Vendor (aws) signs the artifact itself.
type SigCovers int

const (
	SigCoversArtifact SigCovers = iota
	SigCoversChecksumFile
)

// SigInput is the optional signature material for evaluate.
type SigInput struct {
	SignedFile string
	SigFile    string
	KeySource  KeySource
	Covers     SigCovers
}

// GateInput is evaluate's input. ChecksumsText nil means no checksum file.
// An empty string is a present file and must contain the asset.
type GateInput struct {
	Tool          *Tool
	Artifact      string
	ChecksumsText *string
	AssetName     string
	Sig           *SigInput
	Published     time.Time
	Now           time.Time
	CooldownDays  uint32
}

// evaluate is evaluate. It does not download anything.
func evaluate(input *GateInput) (Decision, error) {
	if err := checkCooldown(input.Published, input.Now, input.CooldownDays); err != nil {
		var violation *CooldownViolation
		if errors.As(err, &violation) {
			return Decision{}, blockedFromCooldown(violation)
		}
		return Decision{}, blockedIo(err.Error())
	}

	actual, err := sha256File(input.Artifact)
	if err != nil {
		return Decision{}, blockedIo(err.Error())
	}

	checksumOK := false
	if input.ChecksumsText != nil {
		text := *input.ChecksumsText
		expected, ok := findHash(text, input.AssetName)
		if !ok {
			expected, ok = parseSingleHash(text)
		}
		if !ok {
			return Decision{}, blockedChecksumMissing(input.AssetName)
		}
		if err := verifySha256(input.Artifact, expected); err != nil {
			return Decision{}, blockedHash(err)
		}
		checksumOK = true
	}

	sigOK := false
	if input.Sig != nil {
		if input.Tool.GPGFingerprint == nil {
			return Decision{}, blockedConfig(fmt.Sprintf("%s: sig given but gpg_fingerprint is empty", input.Tool.Name))
		}
		err := gpgVerify(&GpgVerify{
			File:        input.Sig.SignedFile,
			Sig:         input.Sig.SigFile,
			Fingerprint: *input.Tool.GPGFingerprint,
			KeySource:   input.Sig.KeySource,
		})
		if err != nil {
			return Decision{}, blockedSig(err)
		}
		switch input.Sig.Covers {
		case SigCoversArtifact:
			sigOK = true
		case SigCoversChecksumFile:
			sigOK = checksumOK
		default:
			sigOK = false
		}
	}

	pinned, hasPin := pinnedSHA256(input.Tool)
	if hasPin {
		if err := verifySha256(input.Artifact, pinned); err != nil {
			return Decision{}, blockedHash(err)
		}
	}

	switch {
	case sigOK:
		return Decision{Kind: DecisionAllowed, Level: LevelSig, SHA256: actual}, nil
	case checksumOK:
		return Decision{Kind: DecisionAllowed, Level: LevelChecksum, SHA256: actual}, nil
	case hasPin:
		return Decision{Kind: DecisionAllowed, Level: LevelPinned, SHA256: actual}, nil
	}
	if input.Tool.Method == MethodVendor {
		return Decision{Kind: DecisionNeedsPin, SHA256: actual}, nil
	}
	return Decision{}, blockedNoVerification()
}

// pinnedSHA256 is tool.sha256 filtered to a non-blank trim. The returned
// value is already trimmed; verifySha256 trims again.
func pinnedSHA256(tool *Tool) (string, bool) {
	if tool == nil || tool.SHA256 == nil {
		return "", false
	}
	value := strings.TrimSpace(*tool.SHA256)
	if value == "" {
		return "", false
	}
	return value, true
}
