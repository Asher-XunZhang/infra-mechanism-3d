#!/usr/bin/env python3
"""Verify pinned public source evidence without executing imported project code."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request


def verify(manifest, checkout=None, cache=None, fetch=False):
    results = []
    base = manifest['repository'].removesuffix('.git').rstrip('/')
    if not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', base):
        raise ValueError('Only public GitHub repository source URLs are supported')
    for item in manifest['files']:
        revision, relative = item['revision'], item['path']
        if not re.fullmatch(r'[0-9a-f]{40}', revision):
            raise ValueError('Evidence requires a full commit SHA')
        path = Path(relative)
        if path.is_absolute() or '..' in path.parts or '\\' in relative:
            raise ValueError('Evidence paths must stay within the source repository')
        label = f'{revision[:10]}:{relative}'
        try:
            saved = cache / revision / relative if cache else None
            if checkout:
                result = subprocess.run(['git', '-C', str(checkout), 'show', f'{revision}:{relative}'], capture_output=True, check=True)
                data = result.stdout
            elif saved and saved.is_file():
                data = saved.read_bytes()
            elif fetch:
                url = base.replace('https://github.com/', 'https://raw.githubusercontent.com/') + '/' + revision + '/' + relative
                with urllib.request.urlopen(url, timeout=30) as response:
                    data = response.read()
                if saved:
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    saved.write_bytes(data)
            else:
                raise ValueError('Source unavailable; supply --checkout, populated --cache, or --fetch')
            digest = hashlib.sha256(data).hexdigest()
            if digest != item['sha256']:
                raise ValueError('File SHA-256 differs from the reviewed source')
            text = data.decode('utf-8')
            lines = text.splitlines()
            for anchor in item.get('anchors', []):
                line = anchor['line']
                if not isinstance(line, int) or not 1 <= line <= len(lines) or anchor['text'] not in lines[line - 1]:
                    raise ValueError(f'Anchor mismatch at L{line}: {anchor["text"]}')
            for phrase in item.get('contains', []):
                if phrase not in text:
                    raise ValueError(f'Required symbol is missing: {phrase}')
            for phrase in item.get('excludes', []):
                if phrase in text:
                    raise ValueError(f'Unexpected symbol is present: {phrase}')
            results.append({'source': label, 'status': 'verified', 'anchors': len(item.get('anchors', []))})
        except (OSError, ValueError, subprocess.CalledProcessError, urllib.error.URLError) as error:
            results.append({'source': label, 'status': 'failed', 'reason': str(error)})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).resolve().parents[1] / 'docs/source-manifest.json')
    parser.add_argument('--checkout', type=Path, help='Read fixed Git objects without changing the checkout')
    parser.add_argument('--cache', type=Path, help='Files stored under <cache>/<commit>/<repository path>')
    parser.add_argument('--fetch', action='store_true', help='Allow downloading fixed public source files')
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
        results = verify(manifest, args.checkout, args.cache, args.fetch)
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps({'verified': sum(x['status'] == 'verified' for x in results), 'total': len(results), 'results': results}, ensure_ascii=False, indent=2))
    return 0 if results and all(x['status'] == 'verified' for x in results) else 1


if __name__ == '__main__':
    sys.exit(main())
