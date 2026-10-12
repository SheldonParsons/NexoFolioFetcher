#!/usr/bin/env python3
"""Package an already-built Chrome extension for manual OSS distribution."""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='https://asynctest.oss-cn-shenzhen.aliyuncs.com/nexofolio_fetcher/')
parser.add_argument('--plan', type=Path, help='Frozen release plan produced by release-dev.mjs.')
parser.add_argument('--verify-only', action='store_true')
parser.add_argument('--check-secrets-stdin', action='store_true', help='Read private strings through stdin; never log them.')
parser.add_argument('--version', help='Existing archive version for verification.')
args = parser.parse_args()
private_values = json.load(sys.stdin) if args.check_secrets_stdin else []
base = args.base_url.rstrip('/') + '/'
url = urlsplit(base)
if base != 'https://asynctest.oss-cn-shenzhen.aliyuncs.com/nexofolio_fetcher/':
    raise SystemExit('Use a public HTTPS directory URL without credentials, query or fragment.')

source = root / '.output/chrome-mv3'
version = args.version or json.loads((root / 'package.json').read_text())['version']
import re
if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version) or any(int(n) > 65535 for n in version.split('.')):
    raise SystemExit('Use a three-part Chrome version.')
filename = f'NexoFolio-Fetcher-{version}-dev.zip'
output = root / '.output/releases' / f'{version}-dev'
archive_path = output / filename

def verify_archive(path):
    with ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or archive.testzip() is not None:
            raise SystemExit('Invalid ZIP entries or checksum.')
        for name in names:
            parts = Path(name).parts
            if name.startswith('/') or any(part.startswith('.') for part in parts) or name.endswith('.map'):
                raise SystemExit('Unsafe/private archive path.')
        for name in names:
            data = archive.read(name)
            if any(secret.encode() in data for secret in private_values):
                raise SystemExit('Private OSS configuration detected in archive; refusing release.')
        built = json.loads(archive.read('manifest.json'))
        if built.get('manifest_version') != 3 or built.get('name') != 'NexoFolio Fetcher' or built.get('version') != version:
            raise SystemExit('Archive manifest does not match the release version.')
        required = [built['background']['service_worker'], built['side_panel']['default_path'], *built.get('icons', {}).values()]
        if any(name not in names for name in required):
            raise SystemExit('Missing Chrome entrypoint.')
    return built

if args.verify_only:
    verify_archive(archive_path)
    release_text = (output / 'latest.json').read_text()
    if any(secret in release_text for secret in private_values):
        raise SystemExit('Private OSS configuration detected in release metadata; refusing release.')
    release = json.loads(release_text)
    artifact = release['artifact']
    if release['version'] != version or artifact['url'] != base + filename or artifact['filename'] != filename or artifact['size'] != archive_path.stat().st_size or artifact['sha256'] != hashlib.sha256(archive_path.read_bytes()).hexdigest():
        raise SystemExit('Archive and release manifest differ.')
    print('ZIP manifest, entrypoints, CRC, size and SHA-256 verified.')
    raise SystemExit(0)

if not args.plan:
    raise SystemExit('Use npm run release:dev -- --version X.Y.Z --normal|--force --notes-file FILE [--package-only].')
plan = json.loads(args.plan.read_text())
if plan['version'] != version or plan['mode'] not in ('normal', 'force'):
    raise SystemExit('Frozen release plan does not match build.')
manifest = json.loads((source / 'manifest.json').read_text())
if manifest.get('manifest_version') != 3 or manifest.get('name') != 'NexoFolio Fetcher' or manifest.get('version') != version:
    raise SystemExit('Unexpected extension manifest; rebuild first.')
output.mkdir(parents=True, exist_ok=True)
if archive_path.exists():
    raise SystemExit('Archive exists. Retry using --upload-only; never rebuild a frozen version.')

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
    'policyVersion': 1,
    'policyRevision': plan['revision'],
    'minimumVersion': plan['minimumVersion'],
    'releaseMode': plan['mode'],
    'releaseNotes': plan['notes'],
    'artifact': {
        'filename': filename,
        'url': base + filename,
        'size': archive_path.stat().st_size,
        'sha256': digest,
    },
}
verify_archive(archive_path)
(output / 'latest.json').write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n')
(output / '上传与安装说明.md').write_text(f'''# NexoFolio Fetcher {version} 开发版

## 上传

将 `{filename}` 和 `latest.json` 放在同一个 OSS 目录：
`{base}`

必须使用 release-dev.mjs 的冻结计划和发布互斥锁：先上传 ZIP 并核对，再最后发布 latest.json。不要手工覆盖门槛。
- ZIP：Content-Type 为 application/zip，可设置 Content-Disposition 为 attachment。
- latest.json：Content-Type 为 application/json，Cache-Control 建议 no-cache。
- latest.json 由插件后台直连 OSS 读取；后端也从同一固定 OSS 清单取得最低可用版本。
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
