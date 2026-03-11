import os
import subprocess
import sys
import time


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, base)

    handler_path = os.path.join(base, "web", "handler.py")

    print()
    print("  ╔══════════════════════════════════╗")
    print("  ║                                  ║")
    print("  ║        starting up...            ║")
    print("  ║                                  ║")
    print("  ║   http://localhost:5000           ║")
    print("  ║                                  ║")
    print("  ╚══════════════════════════════════╝")
    print()

    os.environ["PYTHONPATH"] = base
    subprocess.run([sys.executable, handler_path])


if __name__ == "__main__":
    main()
