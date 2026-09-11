"""
Put `backend/` on the path so `boxoffice.*` imports resolve.

The package is a subfolder of an existing project rather than an installed
distribution, so pytest needs telling where it lives. Doing it here keeps the
test modules themselves free of path juggling.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
