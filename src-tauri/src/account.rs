//! The player's own Path of Exile account, read with their session cookie
//! (POESESSID): the owner's decision for personal, local use (design doc §4,
//! 2026-11-03). The cookie lives only in the OS credential store (Windows
//! Credential Manager); the web page can save or forget it but never read it
//! back, and it is only ever sent to www.pathofexile.com.

use std::sync::Mutex;
use std::time::{Duration, Instant};

const SERVICE: &str = "POE Cheetah";
const USER: &str = "POESESSID";

/// The account pages the app reads: the account name, its characters and items, its stash tabs.
const ENDPOINTS: [&str; 4] = ["get-account-name", "get-characters", "get-items", "get-stash-items"];

/// GGG's stash limit is 30 requests a minute (2026-11-03): one every 2.1 s stays under it.
const SPACING: Duration = Duration::from_millis(2100);
static LAST: Mutex<Option<Instant>> = Mutex::new(None);

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| format!("The credential store isn't available: {e}"))
}

/// A POESESSID is 32 hex characters; anything else is a pasting mistake.
pub fn valid_session(cookie: &str) -> bool {
    cookie.len() == 32 && cookie.chars().all(|c| c.is_ascii_hexdigit())
}

#[tauri::command]
pub fn poe_session_set(cookie: String) -> Result<(), String> {
    let cookie = cookie.trim().trim_start_matches("POESESSID=").to_string();
    if !valid_session(&cookie) {
        return Err("That isn't a POESESSID (32 letters and digits from your browser's pathofexile.com cookies).".into());
    }
    entry()?.set_password(&cookie).map_err(|e| format!("Could not save it: {e}"))
}

#[tauri::command]
pub fn poe_session_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not forget it: {e}")),
    }
}

/// Whether a session cookie is saved (never the cookie itself).
#[tauri::command]
pub fn poe_session_status() -> bool {
    entry().and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

/// What an account page answered, with GGG's rate-limit headers so the app can pace itself.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountResponse {
    body: String,
    /// `X-Rate-Limit-Ip` (e.g. "30:60:120,90:1800:600") and its `-State` (hits so far).
    rate_limit: Option<String>,
    rate_limit_state: Option<String>,
}

/// The address of an account page; only the account pages the app reads.
pub fn account_url(endpoint: &str, query: &[(String, String)]) -> Result<String, String> {
    if !ENDPOINTS.contains(&endpoint) {
        return Err(format!("Not an account page the app reads: {endpoint}"));
    }
    let mut url = reqwest::Url::parse("https://www.pathofexile.com/character-window/").map_err(|e| e.to_string())?;
    url.set_path(&format!("/character-window/{endpoint}"));
    url.query_pairs_mut().extend_pairs(query);
    Ok(url.to_string())
}

/// Reads one of the player's account pages with their session cookie, at
/// most one request every 2.1 s. A login page instead of JSON means the
/// cookie expired; a 429 means GGG's rate limit was hit (with its wait).
#[tauri::command]
pub async fn poe_account_get(endpoint: String, query: Vec<(String, String)>) -> Result<AccountResponse, String> {
    let url = account_url(&endpoint, &query)?;
    let cookie = entry()?
        .get_password()
        .map_err(|_| "No session cookie saved: connect your account first.".to_string())?;
    let wait = {
        let mut last = LAST.lock().map_err(|e| e.to_string())?;
        let now = Instant::now();
        let at = last.map_or(now, |t| (t + SPACING).max(now));
        *last = Some(at);
        at - now
    };
    if !wait.is_zero() {
        tauri::async_runtime::spawn_blocking(move || std::thread::sleep(wait)).await.map_err(|e| e.to_string())?;
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("POECheetah/", env!("CARGO_PKG_VERSION"), " (personal tool)"))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .header(reqwest::header::COOKIE, format!("POESESSID={cookie}"))
        .send()
        .await
        .map_err(|e| format!("Could not reach pathofexile.com: {e}"))?;
    let status = response.status();
    let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let rate_limit = header("x-rate-limit-ip");
    let rate_limit_state = header("x-rate-limit-ip-state");
    if status.as_u16() == 429 {
        let retry = header("retry-after").unwrap_or_else(|| "?".into());
        return Err(format!("pathofexile.com's rate limit was hit: wait {retry} seconds."));
    }
    let json = header("content-type").is_some_and(|t| t.contains("json"));
    let body = response.text().await.map_err(|e| format!("Could not read pathofexile.com's answer: {e}"))?;
    if !json || status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("pathofexile.com didn't accept the session cookie (it may have expired, e.g. after logging out): set it again.".into());
    }
    if !status.is_success() {
        return Err(format!("pathofexile.com answered {status}: {}", body.chars().take(200).collect::<String>()));
    }
    Ok(AccountResponse { body, rate_limit, rate_limit_state })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_account_pages_on_pathofexile_com() {
        let q = vec![("accountName".to_string(), "Some Name#1234".to_string()), ("tabIndex".to_string(), "3".to_string())];
        assert_eq!(
            account_url("get-stash-items", &q).unwrap(),
            "https://www.pathofexile.com/character-window/get-stash-items?accountName=Some+Name%231234&tabIndex=3"
        );
        assert!(account_url("../../my-account/delete", &[]).is_err());
        assert!(account_url("get-stash-items/../x", &[]).is_err());
    }

    #[test]
    fn checks_the_cookie_looks_like_one() {
        assert!(valid_session("0123456789abcdef0123456789ABCDEF"));
        assert!(!valid_session("0123456789abcdef"));
        assert!(!valid_session("0123456789abcdef0123456789abcdeg"));
    }
}
