"""Synthetic CPU-only worker tests. No live HTTP, model or media download."""
import io
import json
import os
import types
from email.message import Message
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
import import_worker as worker
import public_proxy as proxy

class WorkerTests(unittest.TestCase):
    def test_failure_categories_do_not_echo_remote_secrets(self):
        failures = [
            (worker.urllib.error.HTTPError('https://example.com/?token=PRIVATE',403,'SECRET body',{},None),'HTTP 403'),
            (worker.urllib.error.URLError('SECRET connection info'),'連線失敗或逾時'),
            (ValueError('Only public HTTPS URLs without credentials are supported'),'安全檢查'),
            (ValueError('SECRET model result'),'影音處理失敗'),
            (RuntimeError('Sign in to confirm you are not a bot. Cookie SECRET'),'要求登入'),
            (RuntimeError('SECRET request body'),'影音處理失敗'),
        ]
        for error,expected in failures:
            with self.subTest(expected=expected):
                message=worker.failure_message(error);self.assertIn(expected,message);self.assertNotIn('SECRET',message);self.assertNotIn('PRIVATE',message)
        self.assertEqual(worker.failure_message(worker.ExtractionError('影片超過十分鐘')),'影片超過十分鐘')

    def test_only_official_model_hosts_get_larger_transport_limit(self):
        for host in ['huggingface.co','HUGGINGFACE.CO.','cdn-lfs.huggingface.co','cas-bridge.xethub.hf.co']:
            with self.subTest(host=host):self.assertEqual(proxy.transfer_limit(host),128*1024*1024)
        for host in ['example.com','youtube.com','evil-huggingface.co','huggingface.co.evil.example','hf.co.evil.example','evil-hf.co']:
            with self.subTest(host=host):self.assertEqual(proxy.transfer_limit(host),55*1024*1024)
        self.assertEqual(worker.MAX_BYTES,50*1024*1024,'larger model transport cannot increase source-media download limit')

    def test_tunnel_enforces_selected_host_limit_before_forwarding(self):
        class Payload:
            def __init__(self,size):self.size=size
            def __len__(self):return self.size
        class Socket:
            def __init__(self,chunks=()):self.chunks=iter(chunks);self.sent=[];self.closed=False
            def recv(self,*args):return next(self.chunks,b'')
            def sendall(self,data):self.sent.append(data)
            def settimeout(self,*args):pass
            def setblocking(self,*args):pass
            def close(self):self.closed=True
        for host,size,forwarded in [('example.com',55*1024*1024+1,False),('cdn-lfs.huggingface.co',55*1024*1024+1,True),('huggingface.co',128*1024*1024+1,False),('huggingface.co.evil.example',55*1024*1024+1,False)]:
            with self.subTest(host=host,size=size):
                request=Socket([f'CONNECT {host}:443 HTTP/1.1\r\nHost: {host}\r\n\r\n'.encode(),Payload(size),b'']);remote=Socket();handler=proxy._Handler.__new__(proxy._Handler);handler.request=request
                with patch.object(proxy,'public_addresses',return_value=['8.8.8.8']), patch.object(proxy.socket,'create_connection',return_value=remote) as connect, patch.object(proxy.select,'select',return_value=([request],[],[])):
                    handler.handle()
                self.assertEqual(bool(remote.sent),forwarded,'over-limit bytes must not reach destination');self.assertTrue(remote.closed);self.assertEqual(connect.call_args.args[0],('8.8.8.8',443),'gateway connects to pinned public DNS IP')

    def test_public_dns_is_fail_closed(self):
        def resolver(addresses):
            return lambda *args, **kwargs: [(None, None, None, '', (address, 443)) for address in addresses]
        for addresses in [['127.0.0.1'], ['8.8.8.8', '10.1.2.3'], ['169.254.169.254'], ['100.64.0.1'], ['::1'], ['fc00::1'], ['2001:db8::1'], ['224.0.0.1'], []]:
            with self.subTest(addresses=addresses), self.assertRaises(ValueError):
                proxy.public_addresses('example.com', resolver(addresses))
        self.assertEqual(proxy.public_addresses('example.com', resolver(['8.8.8.8'])), ['8.8.8.8'])
        for host in ['localhost', 'metadata.internal', 'private.local', '127.0.0.1', '[::1]', 'example.com\r\nHost:x', 'user@example.com']:
            with self.subTest(host=host), self.assertRaises(ValueError):
                proxy.public_addresses(host, resolver(['8.8.8.8']))

    def test_url_scheme_credentials_port_size(self):
        with patch.object(proxy, 'public_addresses', return_value=['8.8.8.8']):
            self.assertEqual(proxy.validate_url('https://example.com/a'), 'https://example.com/a')
            for url in ['http://example.com', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com:8443', 'https://example.com/a\nHost:x', 'https://example.com/'+'x'*1000]:
                with self.subTest(url=url[:80]), self.assertRaises(ValueError):
                    proxy.validate_url(url)

    def test_timed_captions_and_explicit_limits(self):
        rows=worker.timed_caption_text(json.dumps({'events':[{'tStartMs':1250,'segs':[{'utf8':'虛構甲店'}, {'utf8':' 菜單300円'}]},{'tStartMs':9000,'segs':[]}]}))
        self.assertEqual(rows, [{'seconds':1.25,'text':'虛構甲店 菜單300円'}])
        vtt='WEBVTT\n\n00:01.000 --> 00:02.000\n<b>虛構甲店</b> &amp; 菜單\n'
        self.assertEqual(worker.timed_caption_text(vtt,'vtt'), [{'seconds':1.0,'text':'虛構甲店 & 菜單'}])
        text, evidence, truncated=worker.cap_evidence(rows+[{'seconds':20,'text':'字'*12000}])
        self.assertTrue(truncated);self.assertEqual(len(evidence),1);self.assertIn('[00:01] 虛構甲店',text);self.assertLessEqual(len(text),12000)
        for content in ['not json', '{}', '{"title":"not captions"}']:
            self.assertEqual(worker.timed_caption_text(content),[])

    def test_body_limit_and_tls_defaults(self):
        class Response(io.BytesIO):
            headers={}
        self.assertEqual(worker._read_bounded(Response(b'OK'),2),b'OK')
        with self.assertRaises(worker.ExtractionError):worker._read_bounded(Response(b'OVER'),2)
        options=worker._youtube_options('http://127.0.0.1:1234','/tmp/synthetic')
        self.assertTrue(options['noplaylist']);self.assertTrue(options['skip_download']);self.assertFalse(options.get('nocheckcertificate',False));self.assertEqual(options['retries'],0);self.assertEqual(options['max_filesize'],50*1024*1024)

    def test_redirect_revalidates_https_and_proxy_both_protocols(self):
        with patch.object(worker.urllib.request, 'build_opener') as build:
            worker.public_opener('http://127.0.0.1:1234')
            handler, redirect = build.call_args.args
            self.assertEqual(handler.proxies, {'https':'http://127.0.0.1:1234','http':'http://127.0.0.1:1234'})
            self.assertIsInstance(redirect, worker.PublicRedirect)
        with patch.object(proxy, 'public_addresses', return_value=['8.8.8.8']):
            request=worker.urllib.request.Request('https://example.com/a')
            for target in ['http://example.com/b','https://user:pass@example.com/b','https://example.com:8443/b']:
                with self.subTest(target=target), self.assertRaises(ValueError):
                    worker.PublicRedirect().redirect_request(request,None,302,'Found',{},target)
            redirected=worker.PublicRedirect().redirect_request(request,None,302,'Found',{},'https://example.org/b')
            self.assertEqual(redirected.full_url,'https://example.org/b')

    def test_article_body_and_login_shell(self):
        class Response(io.BytesIO):
            url='https://example.com/article'
            def __init__(self,content):
                super().__init__(content.encode());self.headers=Message();self.headers['Content-Type']='text/html; charset=utf-8'
        class Opener:
            def __init__(self,html):self.html=html
            def open(self,*args,**kwargs):return Response(self.html)
        def extract_body(*args,**kwargs):
            self.assertTrue(kwargs['include_tables']);self.assertTrue(kwargs['favor_recall'])
            return '虛構甲店 菜單300円'
        with patch.dict(sys.modules,{'trafilatura':types.SimpleNamespace(extract=extract_body)}), patch.object(worker,'validate_url',side_effect=lambda value,*args:value), patch.object(worker,'public_opener',return_value=Opener('<title>虛構公開食記</title><article>虛構甲店</article>')):
            result=worker.extract_article('https://example.com/article','/tmp/synthetic','http://127.0.0.1:1234')
            self.assertEqual(result['text'],'虛構公開食記\n虛構甲店 菜單300円');self.assertEqual(result['title'],'虛構公開食記');self.assertEqual(result['type'],'webpage');self.assertTrue(any('缺項保持待確認' in warning for warning in result['warnings']))
        with patch.dict(sys.modules,{'trafilatura':types.SimpleNamespace(extract=lambda *args,**kwargs:'Log in to Threads to continue reading this public post.')}), patch.object(worker,'validate_url',side_effect=lambda value,*args:value), patch.object(worker,'public_opener',return_value=Opener('<title>Threads</title><article>Log in to Threads to continue.</article>')), self.assertRaises(worker.ExtractionError):
            worker.extract_article('https://example.com/article','/tmp/synthetic','http://127.0.0.1:1234')

    def test_short_article_preserves_real_html_table_evidence(self):
        class Response(io.BytesIO):
            url='https://example.com/branch'
            def __init__(self,markup):
                super().__init__(markup.encode());self.headers=Message();self.headers['Content-Type']='text/html; charset=utf-8'
        markup='<html><head><title>虛構天神支店</title><script>SECRET_SCRIPT</script></head><body><nav>OTHER_BRANCH</nav><main><h1>虛構天神支店</h1><p>'+('虛構餐廳的來源介紹。'*30)+'</p><table><tr><th>營業時間</th><td>11:00–23:00</td></tr><tr><th>菜單</th><td>測試拉麵 900円</td></tr></table><dl><dt>地址</dt><dd>測試市1號</dd></dl></main><footer>UNRELATED_FOOTER</footer></body></html>'
        opener=types.SimpleNamespace(open=lambda *args,**kwargs:Response(markup))
        with patch.dict(sys.modules,{'trafilatura':types.SimpleNamespace(extract=lambda *args,**kwargs:'虛構餐廳的來源介紹。')}),patch.object(worker,'validate_url',side_effect=lambda value,*args:value),patch.object(worker,'public_opener',return_value=opener):
            result=worker.extract_article('https://example.com/branch','/tmp/synthetic','http://127.0.0.1:1234')
        for fact in ['虛構天神支店','11:00–23:00','測試拉麵 900円','測試市1號']:self.assertIn(fact,result['text'])
        for ignored in ['SECRET_SCRIPT','OTHER_BRANCH','UNRELATED_FOOTER']:self.assertNotIn(ignored,result['text'])
        self.assertLessEqual(len(result['text']),worker.MAX_TEXT)

    def test_html_fallback_excludes_explicit_hidden_branch_subtrees(self):
        for attribute in ['hidden','hidden="false"','aria-hidden="true"','style="display:none"','style="DISPLAY: none !important;"','style="visibility:hidden"','style="color:red;display:/*hidden*/none;"']:
            with self.subTest(attribute=attribute):
                markup=f'<body><main>虛構目前分店</main><div {attribute}><section>HIDDEN_BRANCH</section><p>SECRET_PRICE</p></div><p>目前分店的菜單300円</p></body>'
                text=worker.visible_body_text(markup);self.assertIn('虛構目前分店',text);self.assertIn('菜單300円',text);self.assertNotIn('HIDDEN_BRANCH',text);self.assertNotIn('SECRET_PRICE',text)

    def test_existing_proxy_policy_is_never_bypassed(self):
        job={'id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','url':'https://example.com/public'}
        for name in ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy']:
            with self.subTest(name=name), patch.dict(os.environ,{name:'http://managed-proxy.invalid'},clear=True), self.assertRaises(worker.ExtractionError):
                worker.process_job(job,lambda *args: {})

    def test_temp_media_cleanup_on_success_and_failure(self):
        class Gateway:
            url='http://127.0.0.1:1234'
            def __enter__(self):return self
            def __exit__(self,*args):pass
        paths=[]
        def extractor(url,directory,gateway,frames,progress):
            self.assertEqual(url,'https://example.com/public');self.assertFalse(frames);self.assertEqual(gateway,Gateway.url);self.assertEqual(os.environ.get('NO_PROXY',''),'');self.assertEqual(os.environ.get('no_proxy',''),'');self.assertEqual(os.environ['HTTPS_PROXY'],Gateway.url)
            paths.append(Path(directory));(Path(directory)/'fake-media').write_bytes(b'synthetic');return {'text':'虛構字幕'}
        job={'id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','url':'https://example.com/public','options':{'includeFrames':False}}
        with patch.dict(os.environ,{'NO_PROXY':'example.com','no_proxy':'example.org'},clear=True), patch.object(worker,'PublicProxy',Gateway):
            self.assertEqual(worker.process_job(job,extractor),{'text':'虛構字幕'});self.assertEqual(os.environ['NO_PROXY'],'example.com');self.assertEqual(os.environ['no_proxy'],'example.org');self.assertNotIn('HTTPS_PROXY',os.environ)
        self.assertFalse(paths[0].exists(),'successful media is not retained')
        def failure(*args):paths.append(Path(args[1]));raise worker.ExtractionError('synthetic source restriction')
        with patch.dict(os.environ,{},clear=True), patch.object(worker,'PublicProxy',Gateway), self.assertRaises(worker.ExtractionError):worker.process_job(job,failure)
        self.assertFalse(paths[1].exists(),'failed media is not retained')
        with self.assertRaises(worker.ExtractionError):worker.process_job({'id':'bad'},extractor)

if __name__=='__main__':unittest.main()
