use std::{
    collections::{HashMap, VecDeque},
    net::TcpListener as StdTcpListener,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom},
    net::{TcpListener, TcpStream},
};
use uuid::Uuid;

const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_PREVIEW_ROUTES: usize = 64;
const REQUEST_HEADER_TIMEOUT: Duration = Duration::from_secs(5);
const STREAM_CHUNK_BYTES: usize = 128 * 1024;

#[derive(Default)]
struct PreviewRoutes {
    paths_by_token: HashMap<String, PathBuf>,
    tokens_by_path: HashMap<PathBuf, String>,
    insertion_order: VecDeque<String>,
}

impl PreviewRoutes {
    fn register(&mut self, path: PathBuf) -> String {
        if let Some(token) = self.tokens_by_path.get(&path) {
            return token.clone();
        }

        let token = Uuid::new_v4().to_string();
        self.paths_by_token.insert(token.clone(), path.clone());
        self.tokens_by_path.insert(path, token.clone());
        self.insertion_order.push_back(token.clone());

        while self.insertion_order.len() > MAX_PREVIEW_ROUTES {
            let Some(expired_token) = self.insertion_order.pop_front() else {
                break;
            };
            if let Some(expired_path) = self.paths_by_token.remove(&expired_token) {
                self.tokens_by_path.remove(&expired_path);
            }
        }

        token
    }

    fn path_for_token(&self, token: &str) -> Option<PathBuf> {
        self.paths_by_token.get(token).cloned()
    }
}

#[derive(Clone)]
struct MediaPreviewServer {
    port: u16,
    routes: Arc<Mutex<PreviewRoutes>>,
}

#[derive(Debug, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end: u64,
}

static PREVIEW_SERVER: OnceLock<MediaPreviewServer> = OnceLock::new();
static PREVIEW_SERVER_INIT: Mutex<()> = Mutex::new(());

pub fn register_media_preview_path(path: PathBuf) -> Result<String, String> {
    let server = ensure_preview_server()?;
    let token = server
        .routes
        .lock()
        .map_err(|_| "Media preview route state is unavailable.".to_string())?
        .register(path);

    Ok(format!("http://127.0.0.1:{}/media/{token}", server.port))
}

fn ensure_preview_server() -> Result<&'static MediaPreviewServer, String> {
    if let Some(server) = PREVIEW_SERVER.get() {
        return Ok(server);
    }

    let _init_guard = PREVIEW_SERVER_INIT
        .lock()
        .map_err(|_| "Media preview server initialization is unavailable.".to_string())?;
    if let Some(server) = PREVIEW_SERVER.get() {
        return Ok(server);
    }

    let routes = Arc::new(Mutex::new(PreviewRoutes::default()));
    let std_listener = StdTcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Failed starting media preview server: {error}"))?;
    std_listener
        .set_nonblocking(true)
        .map_err(|error| format!("Failed configuring media preview server: {error}"))?;
    let port = std_listener
        .local_addr()
        .map_err(|error| format!("Failed reading media preview server address: {error}"))?
        .port();
    let listener = TcpListener::from_std(std_listener)
        .map_err(|error| format!("Failed activating media preview server: {error}"))?;
    let server = MediaPreviewServer {
        port,
        routes: Arc::clone(&routes),
    };
    let _ = PREVIEW_SERVER.set(server);

    tokio::spawn(async move {
        accept_preview_requests(listener, routes).await;
    });

    PREVIEW_SERVER
        .get()
        .ok_or_else(|| "Media preview server did not initialize.".to_string())
}

async fn accept_preview_requests(listener: TcpListener, routes: Arc<Mutex<PreviewRoutes>>) {
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(connection) => connection,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
        let routes = Arc::clone(&routes);
        tokio::spawn(async move {
            let _ = handle_preview_request(stream, routes).await;
        });
    }
}

async fn handle_preview_request(
    mut stream: TcpStream,
    routes: Arc<Mutex<PreviewRoutes>>,
) -> Result<(), String> {
    let request =
        match tokio::time::timeout(REQUEST_HEADER_TIMEOUT, read_request_headers(&mut stream)).await
        {
            Ok(result) => result?,
            Err(_) => {
                write_response(&mut stream, "408 Request Timeout", &[], &[]).await?;
                return Ok(());
            }
        };
    let Some((request_line, headers)) = request.split_once("\r\n") else {
        write_response(&mut stream, "400 Bad Request", &[], &[]).await?;
        return Ok(());
    };
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let path = request_parts.next().unwrap_or_default();
    if method != "GET" && method != "HEAD" {
        write_response(&mut stream, "405 Method Not Allowed", &[], &[]).await?;
        return Ok(());
    }

    let Some(token) = path.strip_prefix("/media/") else {
        write_response(&mut stream, "404 Not Found", &[], &[]).await?;
        return Ok(());
    };
    let path = {
        routes
            .lock()
            .map_err(|_| "Media preview route state is unavailable.".to_string())?
            .path_for_token(token)
    };
    let Some(path) = path else {
        write_response(&mut stream, "404 Not Found", &[], &[]).await?;
        return Ok(());
    };

    let mut file = File::open(&path)
        .await
        .map_err(|error| format!("Failed opening preview file {}: {error}", path.display()))?;
    let file_len = file
        .metadata()
        .await
        .map_err(|error| {
            format!(
                "Failed reading preview file metadata {}: {error}",
                path.display()
            )
        })?
        .len();
    if file_len == 0 {
        write_response(&mut stream, "416 Range Not Satisfiable", &[], &[]).await?;
        return Ok(());
    }

    let range_header = find_header(headers, "range");
    let range = match range_header {
        Some(value) => {
            let Some(range) = parse_range_header(value, file_len) else {
                let file_len_header = format!("bytes */{file_len}");
                write_response(
                    &mut stream,
                    "416 Range Not Satisfiable",
                    &[
                        ("Accept-Ranges", "bytes"),
                        ("Access-Control-Allow-Origin", "*"),
                        ("Content-Range", file_len_header.as_str()),
                    ],
                    &[],
                )
                .await?;
                return Ok(());
            };
            range
        }
        None => ByteRange {
            start: 0,
            end: file_len - 1,
        },
    };
    let content_len = range.end - range.start + 1;
    let content_type = content_type_for_path(&path);
    let status = if range_header.is_some() {
        "206 Partial Content"
    } else {
        "200 OK"
    };
    let content_len_header = content_len.to_string();
    let content_range = format!("bytes {}-{}/{}", range.start, range.end, file_len);
    let mut response_headers = vec![
        ("Accept-Ranges", "bytes"),
        ("Access-Control-Allow-Origin", "*"),
        ("Cache-Control", "no-store"),
        ("Connection", "close"),
        ("Content-Length", content_len_header.as_str()),
        ("Content-Type", content_type),
    ];
    if range_header.is_some() {
        response_headers.push(("Content-Range", content_range.as_str()));
    }

    write_response_headers(&mut stream, status, &response_headers).await?;
    if method == "HEAD" {
        return Ok(());
    }

    file.seek(SeekFrom::Start(range.start))
        .await
        .map_err(|error| format!("Failed seeking preview file {}: {error}", path.display()))?;
    stream_file_range(&mut stream, &mut file, content_len).await
}

async fn read_request_headers(stream: &mut TcpStream) -> Result<String, String> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    while buffer.len() < MAX_HEADER_BYTES {
        let count = stream
            .read(&mut chunk)
            .await
            .map_err(|error| format!("Failed reading media preview request: {error}"))?;
        if count == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..count]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    String::from_utf8(buffer).map_err(|_| "Media preview request was not valid UTF-8.".to_string())
}

async fn stream_file_range(
    stream: &mut TcpStream,
    file: &mut File,
    mut remaining: u64,
) -> Result<(), String> {
    let mut buffer = vec![0_u8; STREAM_CHUNK_BYTES];
    while remaining > 0 {
        let read_len = usize::try_from(remaining.min(STREAM_CHUNK_BYTES as u64))
            .map_err(|_| "Preview range is too large.".to_string())?;
        let count = file
            .read(&mut buffer[..read_len])
            .await
            .map_err(|error| format!("Failed reading preview file bytes: {error}"))?;
        if count == 0 {
            break;
        }
        stream
            .write_all(&buffer[..count])
            .await
            .map_err(|error| format!("Failed writing preview file bytes: {error}"))?;
        remaining -= count as u64;
    }
    Ok(())
}

async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Result<(), String> {
    let content_len = body.len().to_string();
    let mut response_headers = headers.to_vec();
    response_headers.push(("Content-Length", content_len.as_str()));
    response_headers.push(("Connection", "close"));
    write_response_headers(stream, status, &response_headers).await?;
    stream
        .write_all(body)
        .await
        .map_err(|error| format!("Failed writing media preview response: {error}"))
}

async fn write_response_headers(
    stream: &mut TcpStream,
    status: &str,
    headers: &[(&str, &str)],
) -> Result<(), String> {
    let mut response = format!("HTTP/1.1 {status}\r\n");
    for (name, value) in headers {
        response.push_str(name);
        response.push_str(": ");
        response.push_str(value);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| format!("Failed writing media preview response headers: {error}"))
}

fn find_header<'a>(headers: &'a str, name: &str) -> Option<&'a str> {
    headers.lines().find_map(|line| {
        let (header_name, value) = line.split_once(':')?;
        if header_name.trim().eq_ignore_ascii_case(name) {
            Some(value.trim())
        } else {
            None
        }
    })
}

fn parse_range_header(value: &str, file_len: u64) -> Option<ByteRange> {
    let range = value.strip_prefix("bytes=")?;
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix_len = end.parse::<u64>().ok()?.min(file_len);
        if suffix_len == 0 {
            return None;
        }
        return Some(ByteRange {
            start: file_len - suffix_len,
            end: file_len - 1,
        });
    }

    let start = start.parse::<u64>().ok()?;
    if start >= file_len {
        return None;
    }
    let end = if end.is_empty() {
        file_len - 1
    } else {
        end.parse::<u64>().ok()?.min(file_len - 1)
    };
    if end < start {
        return None;
    }

    Some(ByteRange { start, end })
}

fn content_type_for_path(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("mov") => "video/quicktime",
        _ => "video/mp4",
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{parse_range_header, ByteRange, PreviewRoutes, MAX_PREVIEW_ROUTES};

    #[test]
    fn should_parse_explicit_byte_range() {
        assert_eq!(
            parse_range_header("bytes=10-19", 100),
            Some(ByteRange { start: 10, end: 19 })
        );
    }

    #[test]
    fn should_parse_open_ended_byte_range() {
        assert_eq!(
            parse_range_header("bytes=10-", 100),
            Some(ByteRange { start: 10, end: 99 })
        );
    }

    #[test]
    fn should_parse_suffix_byte_range() {
        assert_eq!(
            parse_range_header("bytes=-20", 100),
            Some(ByteRange { start: 80, end: 99 })
        );
    }

    #[test]
    fn should_reject_invalid_byte_range() {
        assert_eq!(parse_range_header("bytes=20-10", 100), None);
        assert_eq!(parse_range_header("items=0-10", 100), None);
        assert_eq!(parse_range_header("bytes=-0", 100), None);
        assert_eq!(parse_range_header("bytes=100-", 100), None);
    }

    #[test]
    fn should_reuse_preview_routes_for_the_same_path() {
        let mut routes = PreviewRoutes::default();
        let path = PathBuf::from("/tmp/episode.mp4");

        let first_token = routes.register(path.clone());
        let second_token = routes.register(path);

        assert_eq!(first_token, second_token);
        assert_eq!(routes.paths_by_token.len(), 1);
    }

    #[test]
    fn should_evict_the_oldest_preview_route_at_the_limit() {
        let mut routes = PreviewRoutes::default();
        let first_path = PathBuf::from("/tmp/episode-0.mp4");
        let first_token = routes.register(first_path.clone());

        for index in 1..=MAX_PREVIEW_ROUTES {
            routes.register(PathBuf::from(format!("/tmp/episode-{index}.mp4")));
        }

        assert_eq!(routes.paths_by_token.len(), MAX_PREVIEW_ROUTES);
        assert!(routes.path_for_token(&first_token).is_none());
        assert!(!routes.tokens_by_path.contains_key(&first_path));
    }
}
