"""On-demand diagnostics use only fabricated content and fixed public URLs.

No member tasks are created. Public-platform refusal is an observed result,
never a successful extraction. This mode runs only in the trusted workflow.
"""
import json
import os
import re
import signal
import subprocess
import sys
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
    heartbeat = request_json(AUDIENCE, {'action': 'heartbeat'}, github_identity())
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
        cases = [('official_article', 'https://www.ichiran.com/shop/kyushu/tenjin/', extract_article),
                 ('youtube_public_video', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', extract_video)]
        for label, url, extractor in cases:
            try:
                data = process_job({'id': '00000000-0000-4000-8000-000000000002', 'url': url, 'options': {}}, extractor=extractor)
                print(json.dumps({'publicSource': label, 'status': 'read', 'type': data.get('type'), 'evidenceChars': len(data.get('text', ''))}))
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
