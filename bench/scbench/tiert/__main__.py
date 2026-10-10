import sys
from pathlib import Path

if not __package__:
    # Run by path (`python3 /opt/codewatch-a1/tiert ROOT`): make the package importable.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tiert.cli import main  # noqa: E402

sys.exit(main())
