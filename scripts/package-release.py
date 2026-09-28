#!/usr/bin/env python3
"""Package an already-built Chrome extension for manual OSS distribution."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='https://asynctest.oss-cn-shenzhen.aliyuncs.com/nexofolio_fetcher/')
parser.add_argument('--replace-local', action='store_true', help='Rebuild an existing local archive; does not authorize replacing a published ZIP.')
args = parser.parse_args()
base = args.base_url.rstrip('/') + '/'
url = urlsplit(base)
if url.scheme != 'https' or not url.netloc or url.query or url.fragment or url.username:
    raise SystemExit('Use a public HTTPS directory URL without credentials, query or fragment.')

source = root / '.output/chrome-mv3'
manifest = json.loads((source / 'manifest.json').read_text())
version = manifest['version']
if manifest.get('manifest_version') != 3 or manifest.get('name') != 'NexoFolio Fetcher':
    raise SystemExit('Unexpected extension manifest; run npm run build first.')
if version != json.loads((root / 'package.json').read_text())['version']:
    raise SystemExit('Manifest version differs from package.json; rebuild first.')

filename = f'NexoFolio-Fetcher-{version}-dev.zip'
output = root / '.output/releases' / f'{version}-dev'
output.mkdir(parents=True, exist_ok=True)
archive_path = output / filename
if archive_path.exists() and not args.replace_local:
    raise SystemExit(f'{archive_path} already exists. Keep published version files immutable; increment the package version for a new release.')

manifest['version_name'] = f'{version} 开发版'
temporary = archive_path.with_suffix('.zip.tmp')
try:
    with ZipFile(temporary, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(source.rglob('*')):
            if file.is_symlink():
                raise SystemExit(f'Refusing symbolic link: {file}')
            if not file.is_file() or file.name.startswith('.') or file.suffix == '.map':
                continue
            relative = file.relative_to(source).as_posix()
            data = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode() if relative == 'manifest.json' else file.read_bytes()
            info = ZipInfo(relative)  # root entries, no enclosing chrome-mv3 directory
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data, compresslevel=9)
    with ZipFile(temporary) as archive:
        names = set(archive.namelist())
        if 'manifest.json' not in names or archive.testzip() is not None:
            raise SystemExit('Archive integrity check failed.')
        required = [manifest['background']['service_worker'], manifest['side_panel']['default_path'], *manifest.get('icons', {}).values()]
        if any(name not in names for name in required):
            raise SystemExit('The archive is missing a manifest entrypoint or icon.')
    temporary.replace(archive_path)
finally:
    temporary.unlink(missing_ok=True)

digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
release = {
    'schemaVersion': 1,
    'product': 'nexofolio-fetcher',
    'channel': 'development',
    'version': version,
    'builtAt': datetime.now(timezone.utc).isoformat(),
    'installation': 'load-unpacked',
    'minimumChromeVersion': manifest.get('minimum_chrome_version', '125'),
    'artifact': {
        'filename': filename,
        'url': base + filename,
        'size': archive_path.stat().st_size,
        'sha256': digest,
    },
}
(output / 'latest.json').write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n')
(output / '上传与安装说明.md').write_text(f'''# NexoFolio Fetcher {version} 开发版

## 上传

将 `{filename}` 和 `latest.json` 放在同一个 OSS 目录：
`{base}`

先上传 ZIP，确认可以下载，再上传 latest.json。文件名保持不变。
- ZIP：Content-Type 为 application/zip，可设置 Content-Disposition 为 attachment。
- latest.json：Content-Type 为 application/json，Cache-Control 建议 no-cache。
- latest.json 由 NexoFolio 后端读取；网页不再直接获取 OSS 版本清单，无需为版本获取配置 OSS CORS。
- 下载对象应可公开读取；只上传这两个文件，不上传整个源码目录。

## 安装

1. 下载 ZIP 并解压到 `{filename.removesuffix('.zip')}` 文件夹。
2. 在 Chrome 125+ 打开 chrome://extensions，开启开发者模式。
3. 点击“加载未打包的扩展程序”，直接选择解压出的文件夹。
4. 该文件夹里直接包含 manifest.json，无需再进入 chrome-mv3 或其他内层目录。
5. 打开插件后，配置自己的 NexoFolio 服务地址并登录。

ZIP 根目录直接包含 manifest.json、background.js、sidepanel.html、icons 等构建文件。
不同解压软件可能让你选择目标目录；请选择独立文件夹解压，不要额外套第二层同名文件夹。
这是优化构建的手动加载包，不包含源码、开发服务器或浏览器里的账号数据。
开发版不会通过 Chrome 商店自动更新；更新时将新版内容覆盖到同一个固定安装文件夹，再在扩展程序页重新加载。

SHA-256: `{digest}`

本包由当前本地工作区构建，包含未提交修改。本次仅构建和核对包结构，未进行扩展安装或真实录制验收。
''')
print(json.dumps({'zip': str(archive_path), 'manifest': str(output / 'latest.json'), 'bytes': archive_path.stat().st_size, 'sha256': digest}, ensure_ascii=False, indent=2))
