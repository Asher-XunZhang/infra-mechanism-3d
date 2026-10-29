import hashlib
from pathlib import Path
import tempfile
import unittest

from verify_source_evidence import verify


class SourceEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cache = Path(self.directory.name)
        self.revision = 'a' * 40
        self.file = self.cache / self.revision / 'example.py'
        self.file.parent.mkdir(parents=True)
        self.original = b'def entry():\n    return 1\n'
        self.file.write_bytes(self.original)
        self.item = {
            'revision': self.revision, 'path': 'example.py',
            'sha256': hashlib.sha256(self.original).hexdigest(),
            'anchors': [{'line': 1, 'text': 'def entry()'}],
            'excludes': ['new_api'],
        }
        self.manifest = {'repository': 'https://github.com/example/source', 'files': [self.item]}

    def result(self):
        return verify(self.manifest, cache=self.cache)[0]['status']

    def test_reviewed_snapshot_passes(self):
        self.assertEqual(self.result(), 'verified')

    def test_changed_content_fails_even_when_anchor_still_matches(self):
        self.file.write_bytes(self.original.replace(b'return 1', b'return 2'))
        self.assertEqual(self.result(), 'failed')

    def test_moved_anchor_fails(self):
        self.item['anchors'][0]['line'] = 2
        self.assertEqual(self.result(), 'failed')

    def test_unexpected_symbol_fails(self):
        self.item['excludes'] = ['entry']
        self.assertEqual(self.result(), 'failed')

    def test_missing_source_never_means_feature_absent(self):
        self.file.unlink()
        self.assertEqual(self.result(), 'failed')

    def test_unpinned_commit_and_path_escape_are_rejected(self):
        self.item['revision'] = 'main'
        with self.assertRaises(ValueError):
            verify(self.manifest, cache=self.cache)
        self.item['revision'] = self.revision
        self.item['path'] = '../outside.py'
        with self.assertRaises(ValueError):
            verify(self.manifest, cache=self.cache)


if __name__ == '__main__':
    unittest.main()
