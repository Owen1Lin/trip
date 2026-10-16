"""On-demand diagnostics use only fabricated content and fixed public URLs.

No member tasks are created. Public-platform refusal is an observed result,
never a successful extraction. This mode runs only in the trusted workflow.
"""
import json
import base64
import os
import re
import signal
import subprocess
import sys
import urllib.error
from pathlib import Path

from import_worker import (AUDIENCE, MAX_JOB_SECONDS, extract_article, extract_video,
                           github_identity, process_job, request_json)


def synthetic_pipeline(url, directory, proxy, frames, progress):
    from faster_whisper import WhisperModel
    from PIL import Image, ImageDraw, ImageFont
    speech = Path(directory) / 'synthetic.wav'
    subprocess.run(['espeak', '-s', '135', '-w', str(speech), 'Welcome to the sample cafe. Coffee is four hundred yen. Please check the menu.'], check=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    model = WhisperModel('tiny', device='cpu', compute_type='int8', cpu_threads=2)
    segments, _ = model.transcribe(str(speech), beam_size=1, vad_filter=True)
    words = ' '.join(segment.text.strip() for segment in segments).strip()
    if not words:
        raise RuntimeError('Synthetic speech did not produce a transcript')
    image = Image.new('RGB', (900, 280), 'white')
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 42)
    ImageDraw.Draw(image).multiline_text((35, 25), 'DEMO CAFE\nCOFFEE 400 JPY', fill='black', font=font, spacing=20)
    frame = Path(directory) / 'menu.png'
    image.save(frame)
    result = subprocess.run(['tesseract', str(frame), 'stdout', '-l', 'eng+jpn+chi_tra', '--psm', '6'], check=True, timeout=25, capture_output=True, text=True)
    if 'DEMO CAFE' not in result.stdout or '400' not in result.stdout:
        raise RuntimeError('Synthetic menu OCR did not preserve source text')
    return {'transcriptionNonempty': True, 'ocrPreservedTitleAndPrice': True}


def run():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise RuntimeError('Self test runs only on the trusted Actions runner')
    identity = github_identity()
    print('PASS: short-lived GitHub OIDC token issued.', flush=True)
    # Only public workflow identity comparisons, never the token or raw claims.
    encoded = identity.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
    expected = {'iss': 'https://token.actions.githubusercontent.com', 'aud': AUDIENCE,
                'repository': 'Owen1Lin/trip', 'repository_owner': 'Owen1Lin',
                'ref': 'refs/heads/main',
                'workflow_ref': 'Owen1Lin/trip/.github/workflows/import-worker.yml@refs/heads/main',
                'sub': 'repo:Owen1Lin@335954076/trip@1417655111:ref:refs/heads/main',
                'repository_id': '1417655111', 'repository_owner_id': '335954076'}
    print(json.dumps({'identityChecks': {key: claims.get(key) == value for key, value in expected.items()},
                      'numericTimes': {key: isinstance(claims.get(key), (int, float)) for key in ['exp', 'iat', 'nbf']}}), flush=True)
    try:
        heartbeat = request_json(AUDIENCE, {'action': 'heartbeat'}, identity)
    except urllib.error.HTTPError as error:
        # Emit only a bounded server diagnostic code, never tokens or bodies.
        try:
            body = json.loads(error.read(2000))
            code = body.get('code', 'unavailable')
        except (ValueError, AttributeError):
            code = 'unavailable'
        if not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', code):
            code = 'unavailable'
        raise RuntimeError(f'Worker heartbeat HTTP {error.code}; diagnostic={code}') from None
    if heartbeat.get('ok') is not True:
        raise RuntimeError('Real OIDC worker authentication failed')
    print('PASS: real short-lived GitHub OIDC authenticated; no member data used.')
    def expired(*_):
        raise RuntimeError('Bounded diagnostic deadline exceeded')
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(MAX_JOB_SECONDS)
    try:
        result = process_job({'id': '00000000-0000-4000-8000-000000000001', 'url': 'https://example.com/', 'options': {}}, extractor=synthetic_pipeline)
        print('PASS: real CPU faster-whisper and Tesseract ran on fabricated voice/menu.', json.dumps(result))
        cases = [('official_article', 'https://ichiran.com/shop/kyushu/tenjin/', extract_article),
                 ('unsafe_redirect_refused', 'https://www.ichiran.com/shop/kyushu/tenjin/', extract_article),
                 ('youtube_public_video', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', extract_video)]
        for label, url, extractor in cases:
            try:
                data = process_job({'id': '00000000-0000-4000-8000-000000000002', 'url': url, 'options': {}}, extractor=extractor)
                observations = {'publicSource': label, 'status': 'read', 'type': data.get('type'), 'evidenceChars': len(data.get('text', ''))}
                if label == 'official_article':
                    observations['retainedPageDetails'] = {key: word in data.get('text', '') for key, word in [('branch', '天神'), ('hours', '11:00'), ('menuCurrency', '円')]}
                print(json.dumps(observations))
            except Exception as error:
                # No response body or signed downstream URL enters public logs.
                reason = re.sub(r'https?://\S+', '[source URL]', str(error).splitlines()[0])[:400]
                print(json.dumps({'publicSource': label, 'status': 'unavailable', 'errorType': type(error).__name__, 'reason': reason, 'acceptedAsSummary': False}))
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        reason = re.sub(r'https?://\S+', '[diagnostic URL]', str(error).splitlines()[0])[:350]
        print(json.dumps({'diagnostic': 'failed', 'errorType': type(error).__name__, 'reason': reason}), file=sys.stderr)
        sys.exit(1)
