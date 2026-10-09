#!/usr/bin/env bash
# Paste into the existing Timeweb root console; no production writes.
python3 -B - <<'FIZIRA_READ_ONLY_PY'
EXPECTED = [
    {'file': 'frontend/app.js', 'diskPath': '/root/supabase-project/volumes/proxy/app/app.js', 'base': '40f47bdd8bff5cb532bacab291f8866b8d6598af9030d0a9ddecce45f5016b43', 'candidate': '1cd746c981a780911f7b16d4d980efd1c867a3512439a58816b38e65232f4a6f', 'approvedFlower': '41479e121e93b327a22e6c85b849dea183e745a988a0a638ee704005d0938114', 'inCandidate': True},
    {'file': 'frontend/auth-domain.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/auth-domain.mjs', 'base': 'b902755b2064814f679c60a1db0bc5b5be491a5537d735a1ebd4d94ed4624c8f', 'candidate': 'b902755b2064814f679c60a1db0bc5b5be491a5537d735a1ebd4d94ed4624c8f', 'approvedFlower': 'b902755b2064814f679c60a1db0bc5b5be491a5537d735a1ebd4d94ed4624c8f', 'inCandidate': True},
    {'file': 'frontend/cabinet.js', 'diskPath': '/root/supabase-project/volumes/proxy/app/cabinet.js', 'base': 'eb1ab8004d792d7178a6b916dca327a18330fd4540d15fb5f72796d2e28f7ff4', 'candidate': '68453cd0a63d147c828e7568f07264185a598b48ea283fe44911cd37156bfdb3', 'approvedFlower': '68453cd0a63d147c828e7568f07264185a598b48ea283fe44911cd37156bfdb3', 'inCandidate': True},
    {'file': 'frontend/favicon.ico', 'diskPath': '/root/supabase-project/volumes/proxy/app/favicon.ico', 'base': 'b36370b5afc4c3306ce9fe5a0f1535c5cab0be19db3e6e11475e76f6684ca5b0', 'candidate': 'b36370b5afc4c3306ce9fe5a0f1535c5cab0be19db3e6e11475e76f6684ca5b0', 'approvedFlower': 'b36370b5afc4c3306ce9fe5a0f1535c5cab0be19db3e6e11475e76f6684ca5b0', 'inCandidate': True},
    {'file': 'frontend/fizira-symbol.png', 'diskPath': '/root/supabase-project/volumes/proxy/app/fizira-symbol.png', 'base': 'f80f7c4aac35d56218cdc9e2d2f68d60d100915dcabbad6fd711d7525f137726', 'candidate': 'f80f7c4aac35d56218cdc9e2d2f68d60d100915dcabbad6fd711d7525f137726', 'approvedFlower': 'f80f7c4aac35d56218cdc9e2d2f68d60d100915dcabbad6fd711d7525f137726', 'inCandidate': True},
    {'file': 'frontend/index.html', 'diskPath': '/root/supabase-project/volumes/proxy/app/index.html', 'base': 'ee137d71d18672111627550cc83b4c93e0aac2a6b465f09877f35f69870fd6fa', 'candidate': '8d9e37c946056916a0dae2ba082ed60ad7c855611f3ab92556f8638039e19f2f', 'approvedFlower': '118974d7a7f545fa23a647b3cc47eeaea500fc2a4b956251f88730f0bad6e255', 'inCandidate': True},
    {'file': 'frontend/media-fallback.css', 'diskPath': '/root/supabase-project/volumes/proxy/app/media-fallback.css', 'base': 'bc5a6b19c92696fbabf546d700d2011998d5d7733ce452687636d766afcd1975', 'candidate': 'bc5a6b19c92696fbabf546d700d2011998d5d7733ce452687636d766afcd1975', 'approvedFlower': 'bc5a6b19c92696fbabf546d700d2011998d5d7733ce452687636d766afcd1975', 'inCandidate': True},
    {'file': 'frontend/parent-domain.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/parent-domain.mjs', 'base': 'e9118f5613166ee0476cb42059d0f019fa3a689ac45c57476f615b74e8733322', 'candidate': 'e9118f5613166ee0476cb42059d0f019fa3a689ac45c57476f615b74e8733322', 'approvedFlower': 'e9118f5613166ee0476cb42059d0f019fa3a689ac45c57476f615b74e8733322', 'inCandidate': True},
    {'file': 'frontend/parent-report-workspace.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/parent-report-workspace.mjs', 'base': None, 'candidate': None, 'approvedFlower': '233ad3a08fc6129e52c4f519d477d8301678114f31fe20772d04f4286c621e4f', 'inCandidate': False},
    {'file': 'frontend/parent-specialist.js', 'diskPath': '/root/supabase-project/volumes/proxy/app/parent-specialist.js', 'base': 'd09b2242176247c6c563de4453fe093c4cd90a8e6ad8c0d7b196bc5768232d21', 'candidate': '60dc923905e9e6dadd32603e56c7da7515fe12202bcdb43ed0038684679a33c6', 'approvedFlower': '127bd06645ff43bc6766131f4d9a0c1b90f7935d8200cb4d5bed423b1bdaf202', 'inCandidate': True},
    {'file': 'frontend/parent.css', 'diskPath': '/root/supabase-project/volumes/proxy/app/parent.css', 'base': 'b9a86a9201ce5e309d8e2db4943202096e94e1300fd6f5f8917fdf7474ef383a', 'candidate': 'b9a86a9201ce5e309d8e2db4943202096e94e1300fd6f5f8917fdf7474ef383a', 'approvedFlower': 'b9a86a9201ce5e309d8e2db4943202096e94e1300fd6f5f8917fdf7474ef383a', 'inCandidate': True},
    {'file': 'frontend/parent.html', 'diskPath': '/root/supabase-project/volumes/proxy/app/parent.html', 'base': '0d1fa71b59cd0d360f30f08dde9ffc784aa0ac797f8a39ef27ce1ff813256b02', 'candidate': '21359196e94df206cbbdee0bb95285d27f09d9bdc2de3211fcc4911472c79bfe', 'approvedFlower': 'de93f1abdb92ab07c52d05bdac08a154137d308d8a19e347059a957e791a01b3', 'inCandidate': True},
    {'file': 'frontend/parent.js', 'diskPath': '/root/supabase-project/volumes/proxy/app/parent.js', 'base': '186cd708ed7b4fe1005c1d515288bf0c38e4b6f6821b5f3f9cbaaae8987811f0', 'candidate': '186cd708ed7b4fe1005c1d515288bf0c38e4b6f6821b5f3f9cbaaae8987811f0', 'approvedFlower': '186cd708ed7b4fe1005c1d515288bf0c38e4b6f6821b5f3f9cbaaae8987811f0', 'inCandidate': True},
    {'file': 'frontend/patient-flower.css', 'diskPath': '/root/supabase-project/volumes/proxy/app/patient-flower.css', 'base': None, 'candidate': '83330ca85e2da38fd695ceb5156aa7cc9d5d3c78c8c3d446ffab9011712711f6', 'approvedFlower': '83330ca85e2da38fd695ceb5156aa7cc9d5d3c78c8c3d446ffab9011712711f6', 'inCandidate': True},
    {'file': 'frontend/patient-flower.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/patient-flower.mjs', 'base': None, 'candidate': '0f04f22da7bda8434157c96bbcde8ccb6750bde822f364130406b9932d0b55e0', 'approvedFlower': '0f04f22da7bda8434157c96bbcde8ccb6750bde822f364130406b9932d0b55e0', 'inCandidate': True},
    {'file': 'frontend/patient-overview.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/patient-overview.mjs', 'base': None, 'candidate': '757f2ce1a12f22298b5ae23b8240e2c1f1120cae6c0ff8c5c07254bb2d1fb347', 'approvedFlower': '757f2ce1a12f22298b5ae23b8240e2c1f1120cae6c0ff8c5c07254bb2d1fb347', 'inCandidate': True},
    {'file': 'frontend/pdfjs-5.6.205.min.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/pdfjs-5.6.205.min.mjs', 'base': None, 'candidate': None, 'approvedFlower': '2221020ea508479dcc1221f36f2731656339230097c69ba1f78802832c0ad685', 'inCandidate': False},
    {'file': 'frontend/pdfjs-LICENSE.txt', 'diskPath': '/root/supabase-project/volumes/proxy/app/pdfjs-LICENSE.txt', 'base': None, 'candidate': None, 'approvedFlower': '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594', 'inCandidate': False},
    {'file': 'frontend/pdfjs-worker-5.6.205.min.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/pdfjs-worker-5.6.205.min.mjs', 'base': None, 'candidate': None, 'approvedFlower': '51a2fd1ea47f1a9b0814e65e0c336c739c54957795ee774e8f93cb81e8028dd1', 'inCandidate': False},
    {'file': 'frontend/report-pdf-export.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/report-pdf-export.mjs', 'base': '913b140a0e57975e5df7fa4a9634910091a659c9e24b3c7569f38b2fb5b4e4a6', 'candidate': '913b140a0e57975e5df7fa4a9634910091a659c9e24b3c7569f38b2fb5b4e4a6', 'approvedFlower': '952cbdf339ffd170fcb6bac17480fa40ad30d23444b41be1562afae2653d9cda', 'inCandidate': True},
    {'file': 'frontend/report-pdf-preview.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/report-pdf-preview.mjs', 'base': None, 'candidate': None, 'approvedFlower': 'b832bf371111fd163841d95316ff2129f6507d007a53d16ebd36b1a3c64d4472', 'inCandidate': False},
    {'file': 'frontend/role-gate.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/role-gate.mjs', 'base': '11872be290c68285d4845dabede1a5f07aaaef4d3d9f2dd18d41f8b30360cf85', 'candidate': '11872be290c68285d4845dabede1a5f07aaaef4d3d9f2dd18d41f8b30360cf85', 'approvedFlower': '11872be290c68285d4845dabede1a5f07aaaef4d3d9f2dd18d41f8b30360cf85', 'inCandidate': True},
    {'file': 'frontend/schedule-domain.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/schedule-domain.mjs', 'base': '7d5a23ff85b15c775bc2463be0d91b988a1cfe1c22e0ace921450100a3a51625', 'candidate': '7d5a23ff85b15c775bc2463be0d91b988a1cfe1c22e0ace921450100a3a51625', 'approvedFlower': '7d5a23ff85b15c775bc2463be0d91b988a1cfe1c22e0ace921450100a3a51625', 'inCandidate': True},
    {'file': 'frontend/schedule-editor.js', 'diskPath': '/root/supabase-project/volumes/proxy/app/schedule-editor.js', 'base': '95066df029061e727e2b6e2092f6c17705e931abe6555320dcbdcbc3a89cd81b', 'candidate': 'bec38eb7e44a0278d62755317e190f7f218b87185b81e39d7d8e02b3c176ca80', 'approvedFlower': 'bec38eb7e44a0278d62755317e190f7f218b87185b81e39d7d8e02b3c176ca80', 'inCandidate': True},
    {'file': 'frontend/security-utils.mjs', 'diskPath': '/root/supabase-project/volumes/proxy/app/security-utils.mjs', 'base': 'e5be09693f572215e3439c17851bd0cf0d1774285e8a4c6eeed08209af77423f', 'candidate': 'e5be09693f572215e3439c17851bd0cf0d1774285e8a4c6eeed08209af77423f', 'approvedFlower': 'e5be09693f572215e3439c17851bd0cf0d1774285e8a4c6eeed08209af77423f', 'inCandidate': True},
    {'file': 'frontend/styles.css', 'diskPath': '/root/supabase-project/volumes/proxy/app/styles.css', 'base': 'd4f45909147b41b766aa7be7db7111b3ab117734223a5dc096d58fa44f7f5830', 'candidate': 'd4f45909147b41b766aa7be7db7111b3ab117734223a5dc096d58fa44f7f5830', 'approvedFlower': 'f32e87828e998041774b61be1c38ef6f14d6f8c8979a416ab8b8b79b9e6df21d', 'inCandidate': True},
    {'file': 'supabase/config.toml', 'diskPath': '/root/supabase-project/supabase/config.toml', 'base': '38f8ea2f213aaf2fdd0484484f313cd09c71ea51df073e07c69a8cbb3d7236e4', 'candidate': '38f8ea2f213aaf2fdd0484484f313cd09c71ea51df073e07c69a8cbb3d7236e4', 'approvedFlower': '38f8ea2f213aaf2fdd0484484f313cd09c71ea51df073e07c69a8cbb3d7236e4', 'inCandidate': True},
    {'file': 'supabase/functions/_shared/ai-helpers.ts', 'diskPath': '/root/supabase-project/volumes/functions/_shared/ai-helpers.ts', 'base': '7c9e08ada04c6341f4d5c64de4f9c964cfc2d8a32860bd99101906737a07e5e8', 'candidate': '7c9e08ada04c6341f4d5c64de4f9c964cfc2d8a32860bd99101906737a07e5e8', 'approvedFlower': '7c9e08ada04c6341f4d5c64de4f9c964cfc2d8a32860bd99101906737a07e5e8', 'inCandidate': True},
    {'file': 'supabase/functions/_shared/font-data.ts', 'diskPath': '/root/supabase-project/volumes/functions/_shared/font-data.ts', 'base': '98186e6ed21fbf0a6df1eb748c60acf3d390889ddf69f9d304c3b234cd2e8fd8', 'candidate': '98186e6ed21fbf0a6df1eb748c60acf3d390889ddf69f9d304c3b234cd2e8fd8', 'approvedFlower': '98186e6ed21fbf0a6df1eb748c60acf3d390889ddf69f9d304c3b234cd2e8fd8', 'inCandidate': True},
    {'file': 'supabase/functions/_shared/fonts/NotoSans-Regular.ttf', 'diskPath': '/root/supabase-project/volumes/functions/_shared/fonts/NotoSans-Regular.ttf', 'base': 'f5f552c8c5edb61fe6efb824baf4d4de47b1a8689ab4925ff43f7bd6a4ebece5', 'candidate': 'f5f552c8c5edb61fe6efb824baf4d4de47b1a8689ab4925ff43f7bd6a4ebece5', 'approvedFlower': 'f5f552c8c5edb61fe6efb824baf4d4de47b1a8689ab4925ff43f7bd6a4ebece5', 'inCandidate': True},
    {'file': 'supabase/functions/_shared/fonts/OFL.txt', 'diskPath': '/root/supabase-project/volumes/functions/_shared/fonts/OFL.txt', 'base': '3c200cfde6940eb9e953af2ceb44b3a8011df285a11f16fdf447aecf8339ae67', 'candidate': '3c200cfde6940eb9e953af2ceb44b3a8011df285a11f16fdf447aecf8339ae67', 'approvedFlower': '3c200cfde6940eb9e953af2ceb44b3a8011df285a11f16fdf447aecf8339ae67', 'inCandidate': True},
    {'file': 'supabase/functions/_shared/parent-pdf-brand.ts', 'diskPath': '/root/supabase-project/volumes/functions/_shared/parent-pdf-brand.ts', 'base': None, 'candidate': None, 'approvedFlower': '07ab098eaee3cdd6a20b43ac571e5b06852916df3308634913504e9dcf644279', 'inCandidate': False},
    {'file': 'supabase/functions/_shared/parent-pdf.ts', 'diskPath': '/root/supabase-project/volumes/functions/_shared/parent-pdf.ts', 'base': '810baf02e3492d6c467112e680d5c785f5a00c50fc8ae9deefeda71992aee20f', 'candidate': '810baf02e3492d6c467112e680d5c785f5a00c50fc8ae9deefeda71992aee20f', 'approvedFlower': '880e8a29837bb7c3ffeb833cad5f93cc39531cafa9179a128439a8c80bf22c7e', 'inCandidate': True},
    {'file': 'supabase/functions/_shared/parent-portal.ts', 'diskPath': '/root/supabase-project/volumes/functions/_shared/parent-portal.ts', 'base': 'ad75573bb150e94443f862a259e42ba4cf6b79276cf4bf921bfa8bd6242a8db4', 'candidate': 'ad75573bb150e94443f862a259e42ba4cf6b79276cf4bf921bfa8bd6242a8db4', 'approvedFlower': 'ad75573bb150e94443f862a259e42ba4cf6b79276cf4bf921bfa8bd6242a8db4', 'inCandidate': True},
    {'file': 'supabase/functions/_shared/parent-publication.ts', 'diskPath': '/root/supabase-project/volumes/functions/_shared/parent-publication.ts', 'base': '6f0d5aaf95dd5c85be672bc21baf7fcfa049657ec73e27490e4b5ab82f144bc0', 'candidate': '6f0d5aaf95dd5c85be672bc21baf7fcfa049657ec73e27490e4b5ab82f144bc0', 'approvedFlower': '6f0d5aaf95dd5c85be672bc21baf7fcfa049657ec73e27490e4b5ab82f144bc0', 'inCandidate': True},
    {'file': 'supabase/functions/create-parent-invitation/index.ts', 'diskPath': '/root/supabase-project/volumes/functions/create-parent-invitation/index.ts', 'base': 'f1d5c288d61638aa8b86f9cb21765518c32419823bae2bbddaa704d896b6bb64', 'candidate': 'f1d5c288d61638aa8b86f9cb21765518c32419823bae2bbddaa704d896b6bb64', 'approvedFlower': 'f1d5c288d61638aa8b86f9cb21765518c32419823bae2bbddaa704d896b6bb64', 'inCandidate': True},
    {'file': 'supabase/functions/generate-parent-report-pdf/index.ts', 'diskPath': '/root/supabase-project/volumes/functions/generate-parent-report-pdf/index.ts', 'base': '6a350fc2940df98a222d77684ef5bf6b8486eec444f40775b49a24936ff56872', 'candidate': '6a350fc2940df98a222d77684ef5bf6b8486eec444f40775b49a24936ff56872', 'approvedFlower': '6a350fc2940df98a222d77684ef5bf6b8486eec444f40775b49a24936ff56872', 'inCandidate': True},
    {'file': 'supabase/functions/parent-report-file/index.ts', 'diskPath': '/root/supabase-project/volumes/functions/parent-report-file/index.ts', 'base': '0cda79db0873d2f8fe1d101bc9f203673307ddd22d2fe120a5bdddf5fdff5df8', 'candidate': '0cda79db0873d2f8fe1d101bc9f203673307ddd22d2fe120a5bdddf5fdff5df8', 'approvedFlower': '0cda79db0873d2f8fe1d101bc9f203673307ddd22d2fe120a5bdddf5fdff5df8', 'inCandidate': True},
    {'file': 'supabase/functions/ptchild-ai/index.ts', 'diskPath': '/root/supabase-project/volumes/functions/ptchild-ai/index.ts', 'base': '6181b7de17b9da29a8f7fe20dbb7a3e8c3e94408ca2cce2206f1e24e462308b6', 'candidate': '6181b7de17b9da29a8f7fe20dbb7a3e8c3e94408ca2cce2206f1e24e462308b6', 'approvedFlower': '6181b7de17b9da29a8f7fe20dbb7a3e8c3e94408ca2cce2206f1e24e462308b6', 'inCandidate': True},
    {'file': 'supabase/functions/resend-parent-invitation/index.ts', 'diskPath': '/root/supabase-project/volumes/functions/resend-parent-invitation/index.ts', 'base': '2dc3a0aec24a0a1f70b6c2eb338f2136679a6fb8c64ea3748445c335c2bdd3fc', 'candidate': '2dc3a0aec24a0a1f70b6c2eb338f2136679a6fb8c64ea3748445c335c2bdd3fc', 'approvedFlower': '2dc3a0aec24a0a1f70b6c2eb338f2136679a6fb8c64ea3748445c335c2bdd3fc', 'inCandidate': True},
    {'file': 'supabase/functions/revoke-parent-access/index.ts', 'diskPath': '/root/supabase-project/volumes/functions/revoke-parent-access/index.ts', 'base': 'dbbe1d087d81ce3c9a4d1d17a7a519c18181d483a8b8730fb884b34199eedab9', 'candidate': 'dbbe1d087d81ce3c9a4d1d17a7a519c18181d483a8b8730fb884b34199eedab9', 'approvedFlower': 'dbbe1d087d81ce3c9a4d1d17a7a519c18181d483a8b8730fb884b34199eedab9', 'inCandidate': True},
]
import datetime, hashlib, json, os, re, stat, subprocess
from pathlib import Path

# EXPECTED is injected from reviewed Git bytes by the local preparation step.
# Reads only: no databases, credentials, environment dumps, file writes,
# container exec, restarts, network requests, or migrations.
root = Path(os.environ.get('FIZIRA_AUDIT_FIXTURE_ROOT', '/')).resolve()
def local(path):
    return root / path.lstrip('/')
def digest(path):
    try:
        if path.is_symlink(): return 'SYMLINK_STOP'
        if not path.exists(): return 'ABSENT'
        if not path.is_file(): return 'NOT_REGULAR_STOP'
        h = hashlib.sha256()
        with path.open('rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
        return h.hexdigest()
    except OSError as e: return 'UNREADABLE_' + type(e).__name__
def no_symlink_ancestors(path):
    return all(not p.is_symlink() for p in [path, *path.parents])
def inspect_asset(entry):
    path = local(entry['diskPath'])
    actual = digest(path) if no_symlink_ancestors(path) else 'SYMLINK_STOP'
    matches = [version for version in ['base', 'candidate', 'approvedFlower'] if entry.get(version) == actual]
    required = entry['inCandidate']
    approved = actual == entry.get('candidate') or actual == entry.get('base') or (actual == 'ABSENT' and entry.get('base') is None)
    return {'file': entry['file'], 'sha256': actual, 'matches': matches, 'requiredByCandidate': required,
            'candidateSourceStop': required and not approved}
def inspect_backup(path):
    result = {'path': str(path.relative_to(root)), 'state': 'METADATA_ONLY_NOT_VERIFIED'}
    if not no_symlink_ancestors(path): return {**result, 'state': 'SYMLINK_STOP'}
    result['modifiedUtc'] = datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc).isoformat()
    if not path.is_dir(): return {**result, 'bytes': path.stat().st_size}
    backup = path / 'backup' if (path / 'backup').is_dir() else path
    before, release = backup / 'before.tsv', backup / 'release.tsv'
    if not all(p.is_file() and no_symlink_ancestors(p) for p in [backup / 'complete', before, release]): return result
    allowed = {x['file'].removeprefix('frontend/'): x for x in EXPECTED if x['file'].startswith('frontend/')}
    def manifest(file):
        if file.stat().st_size > 65536: raise ValueError('oversize manifest')
        rows = {}
        for row in file.read_text().splitlines():
            name, sha = row.split('\t')
            if name not in allowed or name in rows or not (sha == 'ABSENT' or re.fullmatch('[a-f0-9]{64}', sha)): raise ValueError('unsupported manifest')
            rows[name] = sha
        return rows
    try:
        old, new = manifest(before), manifest(release)
        if not old or set(old) != set(new): raise ValueError('incomplete manifest')
        failures, live_stops = [], []
        for name, sha in old.items():
            saved = backup / 'files' / name
            if sha != 'ABSENT' and (not no_symlink_ancestors(saved) or digest(saved) != sha): failures.append(name)
            live = local(allowed[name]['diskPath'])
            if not no_symlink_ancestors(live) or digest(live) not in [sha, new[name]]: live_stops.append(name)
        result.update(state='BACKUP_HASHES_MATCH' if not failures else 'CORRUPT_BACKUP_STOP',
                      manifestAssets=len(old), corruptAssets=failures, liveRollbackStops=live_stops,
                      guardedRollbackConditionsHold=not failures and not live_stops)
    except (OSError, ValueError, UnicodeError): result['state'] = 'UNVERIFIED_MANIFEST_STOP'
    return result

report = {'scope': 'READ_ONLY_DISK_HASHES_AND_CONTAINER_METADATA_NOT_RUNTIME_EXECUTION_ATTESTATION',
          'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'sourceBase': '51e18c88377a7b20d06eef24b0db9fcb6d45fd3a',
          'approvedFlower': '5b356a6c019209bfbd10578eae9cc0f512c3a5ab',
          'assets': [inspect_asset(entry) for entry in EXPECTED]}
index = local('/root/supabase-project/volumes/proxy/app/index.html')
try:
    if no_symlink_ancestors(index) and index.is_file() and index.stat().st_size < 1024 * 1024:
        match = re.search(r'app\.js\?v=([^"\s]+)', index.read_text())
        report['frontendMarker'] = match.group(1) if match else 'NOT_FOUND'
except (OSError, UnicodeError): report['frontendMarker'] = 'UNREADABLE'
report['rendererDependencyContractInReviewedSource'] = ['npm:pdf-lib@1.17.1', 'npm:@pdf-lib/fontkit@1.1.1', './font-data.ts', 'jsr:@supabase/supabase-js@2']
report['rendererDependencyRuntimeCache'] = 'UNVERIFIED_NO_CACHE_OR_ENV_READS'
report['backups'] = []
for name in ['/root/.cache/fizira-frontend', '/root/.cache/fizira-parent-ux', '/root/fizira-code-backups']:
    path = local(name)
    if not no_symlink_ancestors(path): report['backups'].append({'path': name, 'state': 'SYMLINK_STOP'}); continue
    if not path.exists(): report['backups'].append({'path': name, 'state': 'ABSENT'}); continue
    try:
        entries = sorted(path.iterdir(), key=lambda p: p.lstat().st_mtime, reverse=True)[:5]
        for entry in entries: report['backups'].append(inspect_backup(entry))
    except OSError as e: report['backups'].append({'path': name, 'state': 'UNREADABLE_' + type(e).__name__})
report['containers'] = []
if root != Path('/'):
    report['containerAudit'] = 'SKIPPED_LOCAL_FIXTURE'
else:
    try:
        ps = subprocess.run(['docker', 'ps', '-a', '--format', '{{.ID}}\t{{.Names}}'], capture_output=True, text=True, timeout=20)
        if ps.returncode: raise RuntimeError('docker metadata unavailable')
        template = '{"name":{{json .Name}},"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}},"imageTag":{{json .Config.Image}},"imageId":{{json .Image}},"mounts":{{json .Mounts}}}'
        for row in ps.stdout.splitlines():
            cid, name = row.split('\t', 1)
            if not re.search(r'edge|function|kong|proxy', name, re.I): continue
            inspected = subprocess.run(['docker', 'inspect', '--format', template, cid], capture_output=True, text=True, timeout=20)
            if inspected.returncode: report['containers'].append({'name': name, 'state': 'UNAVAILABLE'}); continue
            data = json.loads(inspected.stdout)
            data['mounts'] = [{k: m.get(k) for k in ['Type', 'Source', 'Destination', 'RW']} for m in data['mounts'] if m.get('Source', '').startswith('/root/supabase-project/volumes/functions') or m.get('Source', '').startswith('/root/supabase-project/volumes/proxy')]
            report['containers'].append(data)
        report['containerAudit'] = 'METADATA_READ'
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired): report['containerAudit'] = 'UNAVAILABLE_NOT_VERIFIED'
report['candidateSourceStops'] = sum(x['candidateSourceStop'] for x in report['assets'])
report['edgeRuntimeGate'] = 'NOT_ATTESTED_REQUIRES_ACTUAL_ISOLATED_RUNTIME_EVIDENCE'
report['publicationReady'] = False
report['sqlVerificationGate'] = 'NOT_ATTESTED_NO_DATABASE_QUERIES_OR_MIGRATIONS'
print(json.dumps(report, ensure_ascii=False, indent=2))
raise SystemExit(1 if report['candidateSourceStops'] else 0)

FIZIRA_READ_ONLY_PY
