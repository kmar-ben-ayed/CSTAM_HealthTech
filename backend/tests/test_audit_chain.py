"""The audit chain stays one valid chain when several writers share the log."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from audit.chain import verify_chain
from audit.logger import AuditLogger
from audit.store import TAIL_BLOCK, AuditStore

WRITER = """
import sys, time
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from audit.logger import AuditLogger
from audit.store import AuditStore
logger = AuditLogger(AuditStore(Path(sys.argv[2])))
for n in range(int(sys.argv[4])):
    logger.log("test_event", f"CG-{n}", sys.argv[3], {"n": n})
    time.sleep(0.005)  # leave room for the other process, so the two really interleave
"""


class AuditChainTest(unittest.TestCase):
    def setUp(self):
        self.workdir = tempfile.TemporaryDirectory()
        self.path = Path(self.workdir.name) / "audit.jsonl"

    def tearDown(self):
        self.workdir.cleanup()

    def test_two_loggers_on_one_file_extend_one_chain(self):
        first, second = AuditLogger(AuditStore(self.path)), AuditLogger(AuditStore(self.path))
        for n in range(5):
            first.log("test_event", f"CG-{n}", "first", {"n": n})
            second.log("test_event", f"CG-{n}", "second", {"n": n})
        entries = AuditStore(self.path).all_entries()
        self.assertEqual(len(entries), 10)
        self.assertEqual(verify_chain(entries), (True, None))

    def test_two_processes_writing_at_once_never_fork_the_chain(self):
        writers = [
            subprocess.Popen([sys.executable, "-c", WRITER, str(BACKEND_ROOT / "src"), str(self.path), name, "150"])
            for name in ("process-a", "process-b")
        ]
        for writer in writers:
            self.assertEqual(writer.wait(timeout=120), 0)
        entries = AuditStore(self.path).all_entries()
        self.assertEqual(len(entries), 300)
        turns = sum(1 for one, other in zip(entries, entries[1:]) if one.actor != other.actor)
        self.assertGreater(turns, 2, "the two writers did not interleave, so nothing was tested")
        self.assertEqual(verify_chain(entries), (True, None))
        # The log is now larger than one tail block: the last entry is still read from the end.
        self.assertGreater(self.path.stat().st_size, TAIL_BLOCK)
        self.assertEqual(AuditStore(self.path).get_last_entry(), entries[-1])


if __name__ == "__main__":
    unittest.main()
