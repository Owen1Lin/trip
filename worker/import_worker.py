"""One bounded private import job per GitHub Actions invocation.

No input, transcript, image, model key, request body, or signed URL is logged.
Original/derived media live only in a TemporaryDirectory and are never artifacts.
"""
import argparse
import json
from html.parser import HTMLParser
import os
import re
import signal
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from public_proxy import PublicProxy, validate_url

MAX_BYTES = 50 * 1024 * 1024
MAX_SECONDS = 600
MAX_TEXT = 12000
MAX_JOB_SECONDS = 480
MAX_FRAMES = 3
API_PATH = '/functions/v1/import-jobs'
AUDIENCE = 'https://lezobidxashxirzijveb.supabase.co' + API_PATH


class ExtractionError(Exception):
    pass


def failure_message(error):
    """Actionable categories without reflecting remote bodies or signed URLs."""
    if isinstance(error, ExtractionError):
        return str(error)[:500]
    if isinstance(error, urllib.error.HTTPError):
        return f'公開來源回應 HTTP {error.code}；未取得摘要，請改貼文字、字幕或圖片。'
    if isinstance(error, (TimeoutError, urllib.error.URLError)):
        return '來源連線失敗或逾時；原始輸入仍保留，可重試或改貼文字、字幕或圖片。'
    if isinstance(error, ValueError) and str(error) in (
        'Invalid public hostname', 'Private hostname is not allowed',
        'Literal IP destinations are not allowed', 'Destination resolves to a non-public address',
        'Invalid URL', 'Only public HTTPS URLs without credentials are supported',
    ):
        return '來源網址或重新導向未通過公開 HTTPS 安全檢查；請提供最終 HTTPS 網址或貼上原文。'
    detail = str(error).lower()
    if 'sign in' in detail or 'log in' in detail or 'not a bot' in detail:
        return '來源要求登入或拒絕自動讀取；未取得摘要，請改貼字幕、文字或截圖。'
    return '公開來源被限制或影音處理失敗；未取得摘要，請貼字幕、文字或圖片，或重試。'


class QuietLogger:
    def debug(self, *args, **kwargs):
        pass
    info = warning = error = debug


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        validate_url(new_url, 8192)
        return super().redirect_request(request, response, code, message, headers, new_url)


def public_opener(proxy):
    # Cover HTTP too: a source redirect must never escape through an unproxied
    # urllib handler. The CONNECT gateway refuses plaintext HTTP requests.
    return urllib.request.build_opener(urllib.request.ProxyHandler({'https': proxy, 'http': proxy}), PublicRedirect())


def _read_bounded(response, limit):
    if int(response.headers.get('Content-Length') or 0) > limit:
        raise ExtractionError('來源超過大小限制。')
    content = response.read(limit + 1)
    if len(content) > limit:
        raise ExtractionError('來源超過大小限制。')
    return content


def request_json(url, body=None, token=None, limit=250000):
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers)
    # Default SSL context verifies the configured CA bundle; never ignore TLS.
    with urllib.request.urlopen(request, timeout=30, context=ssl.create_default_context()) as response:
        return json.loads(_read_bounded(response, limit))


def github_identity():
    request_url = os.environ.get('ACTIONS_ID_TOKEN_REQUEST_URL', '')
    token = os.environ.get('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '')
    parsed = urllib.parse.urlsplit(request_url)
    if parsed.scheme != 'https' or not parsed.hostname or not token:
        raise ExtractionError('GitHub OIDC identity is unavailable')
    separator = '&' if parsed.query else '?'
    result = request_json(request_url + separator + urllib.parse.urlencode({'audience': AUDIENCE}), token=token)
    if not isinstance(result.get('value'), str):
        raise ExtractionError('GitHub OIDC identity is unavailable')
    return result['value']


def timed_caption_text(content, extension='json3'):
    """Only timed source words become evidence; no inferred descriptions."""
    rows = []
    if extension == 'json3':
        try:
            events = json.loads(content).get('events', [])
        except (ValueError, AttributeError):
            events = []
        for event in events:
            text = ''.join(str(segment.get('utf8', '')) for segment in event.get('segs', []))
            text = re.sub(r'\s+', ' ', text).strip()
            if text:
                rows.append({'seconds': max(0, int(event.get('tStartMs', 0))) / 1000, 'text': text})
    else:
        import html
        current = 0.0
        for line in content.splitlines():
            match = re.match(r'(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s+-->', line)
            if match:
                current = int(match[1] or 0) * 3600 + int(match[2]) * 60 + int(match[3]) + int(match[4]) / 1000
            elif line.strip() and not line.startswith(('WEBVTT', 'Kind:', 'Language:', 'NOTE')) and not line.strip().isdigit():
                text = html.unescape(re.sub(r'<[^>]+>', '', line)).strip()
                if text and not (rows and rows[-1]['text'] == text):
                    rows.append({'seconds': current, 'text': text})
    return rows


def cap_evidence(rows):
    result, size, truncated = [], 0, False
    for row in rows:
        if not isinstance(row.get('text'), str) or not row['text'].strip():
            continue
        line = f"[{int(row['seconds']) // 60:02}:{int(row['seconds']) % 60:02}] {row['text'].strip()}"
        if size + len(line) + 1 > MAX_TEXT:
            truncated = True
            break
        result.append({'seconds': row['seconds'], 'text': row['text'].strip()})
        size += len(line) + 1
    text = '\n'.join(f"[{int(row['seconds']) // 60:02}:{int(row['seconds']) % 60:02}] {row['text']}" for row in result)
    return text, result, truncated


def _download_limit(progress):
    if progress.get('downloaded_bytes', 0) > MAX_BYTES:
        raise ExtractionError('影音檔超過 50 MB，已停止。')


def _youtube_options(proxy, directory):
    return {'proxy': proxy, 'quiet': True, 'no_warnings': True, 'logger': QuietLogger(),
            'noplaylist': True, 'skip_download': True, 'socket_timeout': 12, 'retries': 0,
            'fragment_retries': 0, 'cachedir': False, 'max_filesize': MAX_BYTES,
            'progress_hooks': [_download_limit], 'outtmpl': str(Path(directory) / 'media.%(ext)s'),
            'remote_components': set(), 'hls_prefer_native': True}


def extract_video(url, directory, proxy, include_frames=False, progress=lambda phase: None):
    import yt_dlp
    validate_url(url)
    progress('extracting')
    options = _youtube_options(proxy, directory)
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=False)
    if not isinstance(info, dict) or info.get('_type') in ('playlist', 'multi_video') or info.get('is_live') or info.get('live_status') == 'is_live':
        raise ExtractionError('不處理直播或播放清單，請提供單一公開影片。')
    duration = info.get('duration')
    if not isinstance(duration, (int, float)) or not 0 < duration <= MAX_SECONDS:
        raise ExtractionError('目前限 10 分鐘內且可核實長度的公開影片。')
    title = str(info.get('title') or '')[:300]
    rows, warnings, source_type = [], [], 'video_caption'
    progress('captions')
    for automatic in (False, True):
        subtitles = info.get('automatic_captions' if automatic else 'subtitles') or {}
        preferred = sorted(subtitles, key=lambda key: (not key.startswith(('zh', 'ja', 'en')), key))
        for language in preferred:
            formats = subtitles[language]
            track = next((value for ext in ('json3', 'vtt') for value in formats if value.get('ext') == ext and value.get('url')), None)
            if not track:
                continue
            try:
                validate_url(track['url'], 8192)
                opener = public_opener(proxy)
                with opener.open(track['url'], timeout=20) as response:
                    content = _read_bounded(response, 1024 * 1024).decode('utf-8', errors='replace')
                rows = timed_caption_text(content, track['ext'])
            except (OSError, ValueError, urllib.error.URLError, ExtractionError):
                continue
            if rows:
                if automatic:
                    warnings.append('使用平台自動字幕，店名、分店、價格及錯字須人工核對。')
                break
        if rows:
            break
    if not rows:
        progress('transcription')
        source_type = 'video_transcript'
        options.update({'skip_download': False, 'format': 'bestaudio[protocol=https]/worstaudio[protocol=https]/worst[protocol=https]'})
        with yt_dlp.YoutubeDL(options) as downloader:
            downloaded = downloader.extract_info(url, download=True)
            media = Path(downloader.prepare_filename(downloaded))
        if not media.is_file() or media.stat().st_size > MAX_BYTES:
            raise ExtractionError('未取得大小限制內的音訊，請貼字幕或圖片。')
        from faster_whisper import WhisperModel
        model_path = os.environ.get('IMPORT_WHISPER_MODEL', 'tiny')
        model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=2)
        segments, _ = model.transcribe(str(media), beam_size=1, vad_filter=True, condition_on_previous_text=False)
        rows = [{'seconds': float(segment.start), 'text': segment.text.strip()} for segment in segments if segment.text.strip()]
        warnings.append('音訊以 Whisper tiny CPU 轉錄，可能漏字或誤認；尚未核實店名與數字。')
    text, timestamps, truncated = cap_evidence(rows)
    if not text:
        raise ExtractionError('未取得可讀字幕或語音，不能假稱影片摘要成功。')
    if truncated:
        warnings.append('字幕超過 12000 字上限，只保留有時間點的前段；不是完整影片內容。')
    frame_texts = []
    if include_frames:
        progress('frame_ocr')
        options.update({'skip_download': False, 'format': 'worst[protocol=https][vcodec!=none]/worstvideo[protocol=https]', 'outtmpl': str(Path(directory) / 'frames-source.%(ext)s')})
        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                downloaded = downloader.extract_info(url, download=True)
                video = Path(downloader.prepare_filename(downloaded))
            for index, second in enumerate((duration * .2, duration * .5, duration * .8)):
                frame = Path(directory) / f'frame-{index}.png'
                subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-ss', str(second), '-protocol_whitelist', 'file,pipe', '-i', str(video), '-frames:v', '1', '-vf', 'scale=1280:-2', str(frame)], check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                result = subprocess.run(['tesseract', str(frame), 'stdout', '-l', 'eng+jpn+chi_tra', '--psm', '11'], check=True, timeout=25, capture_output=True, text=True)
                visible = result.stdout.strip()[:2000]
                if visible:
                    frame_texts.append({'seconds': round(second, 2), 'text': visible})
            warnings.append('只抽樣 3 個影格做 OCR，並非完整觀看；畫面文字可能辨識錯誤。')
        except (OSError, subprocess.SubprocessError, yt_dlp.utils.DownloadError):
            warnings.append('抽樣影格辨識未完成；保留已取得字幕或轉錄，未猜測畫面資訊。')
    published = str(info.get('upload_date') or '')
    return {'url': url, 'title': title, 'type': source_type, 'text': text, 'timestamps': timestamps[:300],
            'publishedAt': f'{published[:4]}-{published[4:6]}-{published[6:8]}' if re.fullmatch(r'\d{8}', published) else None,
            'frameTexts': frame_texts[:MAX_FRAMES], 'warnings': warnings}


def visible_body_text(markup):
    """Bounded fallback for short restaurant pages whose tables were omitted."""
    class Reader(HTMLParser):
        skipped = {'head','script','style','template','noscript','nav','header','footer','aside','form'}
        void = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
        blocks = {'br','p','div','li','h1','h2','h3','h4','h5','h6','section','tr','td','th','dt','dd','address'}
        def __init__(self):
            super().__init__(convert_charrefs=True);self.stack=[];self.parts=[]
        def handle_starttag(self,tag,attrs):
            if tag in self.blocks:self.parts.append('\n')
            values=dict(attrs);style=re.sub(r'/\*[\s\S]*?\*/','',values.get('style') or '')
            hidden='hidden' in values or (values.get('aria-hidden') or '').lower()=='true' or bool(re.search(r'(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)',style,re.I))
            if tag not in self.void:self.stack.append((tag,tag in self.skipped or hidden))
        def handle_endtag(self,tag):
            tags=[item[0] for item in self.stack]
            if tag in tags:self.stack=self.stack[:len(tags)-1-tags[::-1].index(tag)]
            if tag in self.blocks:self.parts.append('\n')
        def handle_data(self,data):
            if not any(hidden for _,hidden in self.stack):self.parts.append(data)
    reader=Reader();reader.feed(markup);reader.close()
    return '\n'.join(line for part in ''.join(reader.parts).splitlines() if (line := re.sub(r'\s+', ' ', part).strip()))


def extract_article(url, directory, proxy, include_frames=False, progress=lambda phase: None):
    import trafilatura
    validate_url(url)
    progress('extracting')
    request = urllib.request.Request(url, headers={'Accept': 'text/html,application/xhtml+xml', 'User-Agent': 'TripEvidenceReader/2.0'})
    with public_opener(proxy).open(request, timeout=20) as response:
        if response.headers.get_content_type() not in ('text/html', 'application/xhtml+xml'):
            raise ExtractionError('來源不是可讀公開文章。')
        html = _read_bounded(response, 1024 * 1024).decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
        final_url = response.url
    # Restaurant pages often put branch details in short tables alongside a
    # generic introduction. Precision-only extraction discarded those details.
    content = trafilatura.extract(html, include_comments=False, include_tables=True, include_links=False, favor_recall=True) or ''
    if len(content.strip()) < 800:
        visible = visible_body_text(html)
        if len(visible) > len(content) + 200:
            content = visible
    if not content.strip():
        raise ExtractionError('來源沒有可讀正文，可能需登入或禁止公開擷取；請貼上原文或圖片。')
    title_match = re.search(r'<title\b[^>]*>([^<]*)</title>', html, re.I)
    import html as html_module
    title = html_module.unescape(title_match.group(1)).strip()[:300] if title_match else ''
    if re.fullmatch(r'\s*(?:Facebook|Instagram|Threads|Log in|Login|Sign in|登入)(?:\s*[-|].*)?\s*', title, re.I) or re.search(r'log in to (?:facebook|instagram|threads)|sign in to continue|登入以繼續|you must log in to continue', content[:2000], re.I):
        raise ExtractionError('平台只提供登入頁，未取得公開文章；請改貼文字、字幕或圖片。')
    warnings = ['來源是否為官方尚未核實；沒有補查其他官網或評論。']
    if title and title not in content:
        content = title + '\n' + content
    warnings.append('正文由工具擷取，未執行網頁腳本或計算外部 CSS；版型可能漏資料或混入其他區塊，請對照原文核對分店，缺項保持待確認。')
    if len(content) > MAX_TEXT:
        content = content[:MAX_TEXT]
        warnings.append('正文超過 12000 字，只保留前段；不是完整文章。')
    return {'url': final_url, 'title': title, 'type': 'webpage', 'text': content, 'publishedAt': None, 'warnings': warnings}


def process_job(job, extractor=None, progress=lambda phase: None):
    """No source-derived subprocess command, credentials, or file path is accepted."""
    if not isinstance(job, dict) or not re.fullmatch(r'[a-f0-9-]{36}', str(job.get('id', ''))):
        raise ExtractionError('工作資料不正確。')
    if any(os.environ.get(key) for key in ('HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy')):
        raise ExtractionError('此 worker 需要獨立且可固定公開 IP 的 runner；不繞過既有代理政策。')
    if extractor is None:
        hostname = urllib.parse.urlsplit(job['url']).hostname or ''
        video = any(hostname == base or hostname.endswith('.' + base) for base in ('youtube.com', 'youtu.be', 'instagram.com', 'facebook.com', 'fb.watch'))
        extractor = extract_video if video else extract_article
    with tempfile.TemporaryDirectory(prefix='trip-private-import-') as directory:
        with PublicProxy() as proxy:
            # Also constrain model downloads and subprocess libraries that
            # respect standard proxy settings. ffmpeg reads local files only.
            names = ('HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy')
            previous = {name: os.environ.get(name) for name in names}
            try:
                for name in names:
                    if name.lower() == 'no_proxy':
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = proxy.url
                return extractor(job['url'], directory, proxy.url, bool(job.get('options', {}).get('includeFrames')), progress)
            finally:
                for name, value in previous.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--claim-only', action='store_true')
    parser.add_argument('--job-file', default='')
    args = parser.parse_args()
    # This entrypoint is for a standard GitHub runner, not a proxy-restricted
    # Codex executor. Do not silently bypass an inherited session egress policy.
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ExtractionError('背景 worker 僅由已驗證的 GitHub Actions 執行；本機只跑隔離測試。')
    identity = github_identity()
    if args.claim_only:
        result = request_json(AUDIENCE, {'action': 'claim'}, identity)
        job = result.get('job')
        if args.job_file and job:
            target = Path(args.job_file)
            target.write_text(json.dumps(job), encoding='utf-8')
            target.chmod(0o600)
        output = os.environ.get('GITHUB_OUTPUT')
        if output:
            with open(output, 'a') as stream:
                stream.write('has_job=' + ('true' if job else 'false') + '\n')
        print('Private import queue checked; task payload is not logged.')
        return
    job = json.loads(Path(args.job_file).read_text(encoding='utf-8'))
    result, error = None, None
    def deadline(*_):
        raise ExtractionError('工作超過 8 分鐘，已停止；可重試或提供字幕／圖片。')
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(MAX_JOB_SECONDS)
    try:
        def progress(phase):
            request_json(AUDIENCE, {'action': 'progress', 'jobId': job['id'], 'leaseToken': job['leaseToken'], 'phase': phase}, github_identity())
        result = process_job(job, progress=progress)
    except Exception as exc:
        error = failure_message(exc)
    finally:
        signal.alarm(0)
        Path(args.job_file).unlink(missing_ok=True)
    # Refresh OIDC after potentially lengthy processing; no user token is kept.
    identity = github_identity()
    response = request_json(AUDIENCE, {'action': 'complete', 'jobId': job['id'], 'leaseToken': job['leaseToken'], 'result': result, 'error': error}, identity)
    if response.get('ok') is not True:
        raise ExtractionError('Task lease expired; stale result was not written')
    print('Private import processing finished; no media or transcript was logged.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Avoid urllib/yt-dlp exceptions exposing signed source URLs or bodies.
        print('Import worker could not finish. Check private task status; no input was logged.', file=sys.stderr)
        sys.exit(1)
