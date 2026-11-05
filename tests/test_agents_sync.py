"""moddeck's External Agent box and the external-agent mod each carry agents.ts (a mod can only import its own files)."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class AgentsSync(unittest.TestCase):
    def test_both_copies_of_agents_ts_are_identical(self):
        a = (ROOT / "mods" / "moddeck" / "hooks" / "agents.ts").read_bytes()
        b = (ROOT / "mods" / "external-agent" / "hooks" / "agents.ts").read_bytes()
        self.assertEqual(a, b, "edit mods/moddeck/hooks/agents.ts, then copy it to mods/external-agent/hooks/agents.ts")


if __name__ == "__main__":
    unittest.main()
