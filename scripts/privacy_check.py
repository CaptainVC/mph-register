#!/usr/bin/env python3
"""Refuses commits and pushes that carry real data of the firm or of any party: everything in git must be test data.

Two layers of checks:
  * Generic rules, kept in this file and run everywhere (CI included): GSTINs and PANs must use the TEST PAN family
    (e.g. 08TESTF1234A1Z?), IFSC codes the TEST0 bank, account numbers start 000000, mobile numbers 900000, Udyam
    numbers the XX state; no workbooks, data files, VBA modules, images or embedded pictures (a signature).
  * Private terms, never in git: read on this machine from the real config and data files (MPH_DATA_DIR or
    Documents/MPH Register Data, plus its backups), from the workbooks (MPH_WORKBOOKS or the Workbooks folder next to
    the worktrees, cached by --refresh) and from ~/.config/mph-register/extra-terms.txt (one term per line).
    They cover the firm's details, party names, addresses, GSTINs, phone and bank numbers.

Usage (the hooks in .githooks run it; scripts/setup-repo.sh turns them on):
  privacy_check.py                   every tracked file in the working tree
  privacy_check.py --staged          the staged files (pre-commit)
  privacy_check.py --message FILE    a commit message (commit-msg)
  privacy_check.py --commits RANGE   every commit in RANGE: message and changed files (pre-push, CI)
  privacy_check.py --tree REV        every file at REV
  privacy_check.py --text TEXT       any text (CI checks the pull request title and body)
  privacy_check.py --refresh         rebuild the private cache from the workbooks
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

CONFIG_DIR = Path(os.environ.get("MPH_PRIVACY_DIR") or Path.home() / ".config" / "mph-register")
CACHE_FILE = CONFIG_DIR / "workbook-terms.txt"
NAMES_CACHE_FILE = CONFIG_DIR / "workbook-names.txt"
EXTRA_FILE = CONFIG_DIR / "extra-terms.txt"
IN_CI = os.environ.get("CI") == "true"

# Binary files that may be committed: the frozen synthetic v0.4 fixture (its text is checked too), the fonts and the app icon.
ALLOWED_BINARIES = (
    re.compile(r"^app/tests/fixtures/v04-seeded\.db$"),
    re.compile(r"^app/src/MPHRegister\.Api/wwwroot/fonts/[^/]+\.woff2$"),
    re.compile(r"^app/src/MPHRegister\.Api/wwwroot/favicon\.ico$"),
)
FORBIDDEN_EXTENSIONS = {
    ".xls", ".xlsx", ".xlsm", ".xlsb", ".ods", ".csv", ".db", ".sqlite", ".sqlite3", ".db-wal", ".db-shm",
    ".db-journal", ".bak", ".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff",
    ".webp", ".heic", ".bas", ".cls", ".frm", ".zip", ".7z", ".rar",
}
FORBIDDEN_NAMES = re.compile(r"(^|/)(mph-data[^/]*|mph-config[^/]*\.json[^/]*)$", re.I)

# Words that are not private on their own; a party token in this list is only caught as part of the full name.
COMMON_WORDS = set("""
    AND THE FOR WITH FROM NEAR ROAD STREET MARKET AREA PHASE PLOT SHOP FLOOR BUILDING NAGAR COLONY OPP BEHIND
    MILL MILLS TEX TEXT TEXTILE TEXTILES TEXO PRINT PRINTS PRINTERS PRINTING FAB FABS FABRIC FABRICS INDUSTRY
    INDUSTRIES PRODUCT PRODUCTS INDIA INDIAN COTTON DYEING DYEINGS ENTERPRISE ENTERPRISES PROCESS PROCESSORS
    PROCESSING HOUSE REGD PVT LTD LIMITED PRIVATE COMPANY CORPORATION TRADING TRADERS TRADE SILK SILKS CLOTH
    CLOTHING SYNTHETIC SYNTHETICS CREATION CREATIONS FASHION FASHIONS IMPEX EXPORTS EXPORT OVERSEAS GROUP
    INTERNATIONAL GARMENTS GARMENT WORKS WEAVING YARN YARNS DENIM SUITING SUITINGS SHIRTING TEXFAB SONS BROTHERS
    INDUSTRIAL ESTATE ZONE SECTOR TOWN CITY DISTRICT STATE PARTY FIRM BILL BILLS NONE TEST
    RAJASTHAN GUJARAT MAHARASHTRA PUNJAB HARYANA DELHI KARNATAKA KERALA BIHAR ODISHA ASSAM GOA TAMIL NADU UTTAR
    PRADESH MADHYA ANDHRA TELANGANA WEST BENGAL JHARKHAND CHHATTISGARH UTTARAKHAND HIMACHAL JAMMU KASHMIR SIKKIM
    TRIPURA MANIPUR MEGHALAYA MIZORAM NAGALAND ARUNACHAL LADAKH CHANDIGARH PUDUCHERRY
    TAX INVOICE ORIGINAL COPY CODE CHARGE CHARGES PAYMENT CHEQUE ONLY PAYEE BANK AUTHORIZED AUTHORISED SIGNATORY
    CHECKED JURISDICTION SUBJECT GOODS DAMAGE DURING TRANSIT OTHER MUST MADE WITHIN DAYS DATE WHICH WILL
    APPLICABLE ALLOWED RESPONSIBLE REGISTRATION ENTERPRISE MICRO TYPE MOB OFF MSME UDYAM LINK KOHINOOR
""".split())

GSTIN = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b", re.I)
PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
IFSC = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
ACCOUNT = re.compile(r"\bA\s*/?\s*C\.?\s*(?:NO\.?|NUMBER)?\s*[:.\-]?\s*(\d[\d \-]{6,}\d)", re.I)
MOBILE = re.compile(r"(?:\+91[\s\-]?|\b)([6-9]\d{4}[\s\-]?\d{5})\b")
UDYAM = re.compile(r"\b(?:UDYAM-)?([A-Z]{2})-\d{2}-\d{7}\b", re.I)
IMAGE_DATA = re.compile(r"(?:iVBORw0KGgo|/9j/|R0lGOD|UklGR)[A-Za-z0-9+/=]{300,}")


def is_test_pan(pan: str) -> bool:
    """TEST… PANs are test data; ABCDE1234F is the usual example PAN (the GSTIN placeholder in the app)."""
    return pan.upper().startswith("TEST") or pan.upper() == "ABCDE1234F"


def generic_findings(line: str) -> list[str]:
    found = []
    for m in GSTIN.finditer(line):
        if not is_test_pan(m.group(0)[2:12]):
            found.append(f"GSTIN {m.group(0)} (test GSTINs use a TEST… PAN)")
    for m in PAN.finditer(line):
        if not is_test_pan(m.group(0)):
            found.append(f"PAN-like {m.group(0)} (test PANs start TEST)")
    for m in IFSC.finditer(line):
        if not m.group(0).startswith("TEST0"):
            found.append(f"IFSC-like {m.group(0)} (test IFSC codes start TEST0)")
    for m in ACCOUNT.finditer(line):
        if not re.sub(r"\D", "", m.group(1)).startswith("000000"):
            found.append(f"account number {m.group(1)} (test accounts start 000000)")
    for m in MOBILE.finditer(line):
        if not re.sub(r"\D", "", m.group(1)).startswith("900000"):
            found.append(f"mobile number {m.group(1)} (test mobiles start 900000)")
    for m in UDYAM.finditer(line):
        if m.group(1).upper() != "XX":
            found.append(f"Udyam number {m.group(0)} (test Udyam numbers use XX)")
    if IMAGE_DATA.search(line):
        found.append("an embedded picture (a signature or photo); tests use a 1x1 PNG")
    return found


# ---------------------------------------------------------------- private terms (never committed)

def project_folder() -> Path | None:
    try:
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                                capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    common_path = Path(common)
    return common_path.parent


def data_folders() -> list[Path]:
    folders = []
    if os.environ.get("MPH_DATA_DIR"):
        folders.append(Path(os.environ["MPH_DATA_DIR"]))
    folders.append(Path.home() / "Documents" / "MPH Register Data")
    project = project_folder()
    if project:
        folders += [p.parent for p in (project / "Builds").glob("*/MPH Register Data/mph-config.json")]
    return [f for f in folders if f.is_dir()]


def workbook_folder() -> Path | None:
    if os.environ.get("MPH_WORKBOOKS"):
        return Path(os.environ["MPH_WORKBOOKS"])
    project = project_folder()
    return project / "Workbooks" if project else None


class Terms:
    def __init__(self) -> None:
        self.phrases: set[str] = set()
        self.codes: set[str] = set()

    def add_name(self, text: str | None) -> None:
        if not text or not isinstance(text, str):
            return
        tokens = re.findall(r"[A-Za-z0-9]+", text.upper())
        for end in range(2, len(tokens) + 1):
            part = tokens[:end]
            if sum(len(t) for t in part) >= 6 and any(t not in COMMON_WORDS and not t.isdigit() for t in part):
                self.phrases.add(" ".join(part))
        if len(tokens) == 1 and len(tokens[0]) >= 4 and not tokens[0].isdigit():
            self.phrases.add(tokens[0])
        for token in tokens:
            if len(token) >= 4 and token.isalpha() and token not in COMMON_WORDS:
                self.phrases.add(token)
        self.add_numbers(text)

    def add_numbers(self, text: str | None) -> None:
        if not text or not isinstance(text, str):
            return
        for run in re.findall(r"\d[\d \-]{4,}\d", text):
            digits = re.sub(r"\D", "", run)
            if len(digits) >= 6:
                self.codes.add(digits)
        for pattern in (GSTIN, PAN, IFSC):
            for m in pattern.finditer(text.upper()):
                self.codes.add(m.group(0))
                if pattern is GSTIN:
                    self.codes.add(m.group(0)[2:12])
        for m in UDYAM.finditer(text):
            self.codes.add(re.sub(r"[^A-Z0-9]", "", m.group(0).upper()))

    def add_person(self, text: str | None) -> None:
        """A lorry wala's name: private unless it is only common words (such as PARTY, the party's own vehicle)."""
        if not text or not isinstance(text, str):
            return
        tokens = re.findall(r"[A-Za-z0-9]+", text.upper())
        if tokens and all(t in COMMON_WORDS or len(t) < 3 for t in tokens):
            return
        self.add_name(text)

    def add_text(self, text: str | None) -> None:
        """Free text such as the bank line: only its numbers and codes are private, and any non-common word."""
        if not text or not isinstance(text, str):
            return
        self.add_numbers(text)
        for token in re.findall(r"[A-Za-z]+", text.upper()):
            if len(token) >= 4 and token not in COMMON_WORDS and token not in ENGLISH_WORDS:
                self.phrases.add(token)

    def add_picture(self, data: str | None) -> None:
        if data and isinstance(data, str) and len(data) > 200:
            payload = data.split(",", 1)[-1]
            self.codes.add(payload[100:140])

    def empty(self) -> bool:
        return not self.phrases and not self.codes


# Numbers on the bill that are public: the SAC code of textile job work.
PUBLIC_CODES = {"998821"}

# Ordinary English words of the printed texts, so "Payment by payee's A/C Cheque only." is not a private term.
ENGLISH_WORDS = set("""
    ABOUT AMOUNT CODE COPY DATED DETAILS DISCOUNT GROSS HEADER INVOICE KIND LABEL LESS LINE NAME NET NUMBER
    PERIOD RATE TAXABLE TERMS THAN TITLE TOTAL WORDS RUPEES SAC GSTN GSTIN CGST SGST IGST FINISH LOT JOB
""".split())


def add_config(terms: Terms, config: dict) -> None:
    firm = config.get("firm") or {}
    if isinstance(firm, dict):
        terms.add_name(firm.get("name") or firm.get("firmName"))
        for key, value in firm.items():
            if key not in ("name", "firmName", "homeStateCode", "homeStateName") and isinstance(value, str):
                terms.add_text(value)
    printed = config.get("printedTexts") or {}
    if isinstance(printed, dict):
        for value in printed.values():
            for text in value if isinstance(value, list) else [value]:
                terms.add_text(text)
    terms.add_picture(config.get("signature"))
    for party in config.get("parties") or []:
        if not isinstance(party, dict):
            continue
        terms.add_name(party.get("name"))
        terms.add_name(party.get("billAs"))
        terms.add_name(party.get("sisterGroup"))
        terms.add_name(party.get("address"))
        terms.add_numbers(party.get("gstin"))
    for transporter in config.get("transporters") or []:
        if not isinstance(transporter, dict):
            continue
        terms.add_person(transporter.get("name"))
        for spelling in transporter.get("otherSpellings") or []:
            terms.add_person(spelling)


def add_database(terms: Terms, path: Path) -> None:
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        queries = {
            "entries": "SELECT DISTINCT party, '', '' FROM entries",
            "invoices": "SELECT DISTINCT party_name, address, gstin FROM invoices",
            "parties": "SELECT name || '|' || bill_to, address, gstin FROM parties",
        }
        for table, query in queries.items():
            if table in tables:
                for names, address, gstin in db.execute(query):
                    for name in (names or "").split("|"):
                        terms.add_name(name)
                    terms.add_name(address)
                    terms.add_numbers(gstin)
        for table in ("arrivals", "deleted_arrivals"):
            if table in tables:
                for party, transporter in db.execute(f"SELECT DISTINCT party, transporter FROM {table}"):
                    terms.add_name(party)
                    terms.add_person(transporter)
        if "settings" in tables:
            for key, value in db.execute("SELECT key, value FROM settings WHERE key IN ('firm', 'signature_png')"):
                if key == "firm":
                    add_config(terms, {"firm": json.loads(value)})
                else:
                    terms.add_picture(value if isinstance(value, str) else base64.b64encode(value).decode())
        db.close()
    except (sqlite3.Error, ValueError):
        pass


def workbook_strings(path: Path) -> list[str]:
    try:
        with zipfile.ZipFile(path) as book:
            texts = []
            for name in book.namelist():
                if name == "xl/sharedStrings.xml" or (name.startswith("xl/worksheets/") and name.endswith(".xml")):
                    xml = book.read(name).decode("utf-8", "replace")
                    texts += [re.sub(r"<[^>]+>", "", t) for t in re.findall(r"<t[^>]*>(.*?)</t>", xml, re.S)]
            return texts
    except (OSError, zipfile.BadZipFile):
        return []


def lorry_names(path: Path) -> list[str]:
    """The names under the "Lorry Wala" header of an AAWAK workbook's sheets (the hidden Details sheet's list)."""
    try:
        with zipfile.ZipFile(path) as book:
            shared = []
            if "xl/sharedStrings.xml" in book.namelist():
                xml = book.read("xl/sharedStrings.xml").decode("utf-8", "replace")
                for item in re.findall(r"<si>(.*?)</si>", xml, re.S):
                    shared.append("".join(re.findall(r"<t[^>]*>(.*?)</t>", item, re.S)))
            names = []
            for name in book.namelist():
                if not (name.startswith("xl/worksheets/") and name.endswith(".xml")):
                    continue
                xml = book.read(name).decode("utf-8", "replace")
                cells = {}
                for ref, attrs, body in re.findall(r'<c r="([A-Z]+\d+)"([^>]*)>(.*?)</c>', xml, re.S):
                    value = re.search(r"<v>(.*?)</v>", body, re.S)
                    inline = re.search(r"<t[^>]*>(.*?)</t>", body, re.S)
                    if 't="s"' in attrs and value and value.group(1).isdigit() and int(value.group(1)) < len(shared):
                        cells[ref] = shared[int(value.group(1))]
                    elif inline:
                        cells[ref] = inline.group(1)
                for ref, text in cells.items():
                    if text.strip().upper() != "LORRY WALA":
                        continue
                    column, row = re.match(r"([A-Z]+)(\d+)", ref).groups()
                    following = chr(ord(column[-1]) + 1) if len(column) == 1 and column < "Z" else ""
                    if cells.get(f"{following}{row}", "").strip().upper() != "ACTIVE":
                        continue
                    below = int(row) + 1
                    while cells.get(f"{column}{below}", "").strip():
                        names.append(cells[f"{column}{below}"].strip())
                        below += 1
            return names
    except (OSError, zipfile.BadZipFile, KeyError):
        return []


def refresh_cache(quiet: bool = False) -> None:
    folder = workbook_folder()
    if not folder or not folder.is_dir():
        if not quiet:
            print(f"privacy: no workbooks folder ({folder}); nothing to cache.")
        return
    terms = Terms()
    lorries: set[str] = set()
    for book in sorted(folder.rglob("*.xls*")):
        if book.name.startswith("~$"):
            continue
        for text in workbook_strings(book):
            terms.add_numbers(text)
        if "AWAK" in book.name.upper():
            lorries.update(lorry_names(book))
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=CONFIG_DIR, delete=False, encoding="utf-8") as out:
        out.write("# Lorry-wala names from the AAWAK workbooks, built by scripts/privacy_check.py --refresh; never commit.\n")
        out.write("\n".join(sorted(lorries)) + "\n")
    os.replace(out.name, NAMES_CACHE_FILE)
    with tempfile.NamedTemporaryFile("w", dir=CONFIG_DIR, delete=False, encoding="utf-8") as out:
        out.write("# Built by scripts/privacy_check.py --refresh from the workbooks; never commit.\n")
        out.write("\n".join(sorted(terms.codes)) + "\n")
    os.replace(out.name, CACHE_FILE)
    if not quiet:
        print(f"privacy: cached {len(terms.codes)} numbers and codes from {folder} in {CACHE_FILE}")


def load_private_terms() -> tuple[tuple[re.Pattern[str] | None, re.Pattern[str] | None], list[str]]:
    terms = Terms()
    sources = []
    for folder in data_folders():
        for config_path in [folder / "mph-config.json", *sorted((folder / "backups").glob("mph-config*.json"))]:
            try:
                add_config(terms, json.loads(config_path.read_text(encoding="utf-8")))
                sources.append(str(config_path))
            except (OSError, ValueError):
                pass
        for db_path in [folder / "mph-data.db", *sorted((folder / "backups").glob("*.db"))]:
            if db_path.is_file():
                add_database(terms, db_path)
                sources.append(str(db_path))
    books = workbook_folder()
    if books and books.is_dir():
        newest = max((p.stat().st_mtime for p in books.rglob("*.xls*")), default=0)
        stale = min((p.stat().st_mtime for p in (CACHE_FILE, NAMES_CACHE_FILE) if p.exists()), default=0)
        if not CACHE_FILE.exists() or not NAMES_CACHE_FILE.exists() or stale < newest:
            refresh_cache(quiet=True)
    adders = {CACHE_FILE: terms.codes.add, NAMES_CACHE_FILE: terms.add_person, EXTRA_FILE: terms.add_name}
    for path, add in adders.items():
        if path.exists():
            sources.append(str(path))
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    add(line)
    phrase_pattern = code_pattern = None
    phrases = sorted(terms.phrases, key=len, reverse=True)
    if phrases:
        body = "|".join(r"[^A-Za-z0-9]{0,3}".join(re.escape(t) for t in p.split()) for p in phrases)
        phrase_pattern = re.compile(rf"(?<![A-Za-z0-9])(?:{body})(?![A-Za-z0-9])", re.I)
    codes = sorted((c for c in terms.codes - PUBLIC_CODES if len(c) >= 6), key=len, reverse=True)
    if codes:
        body = "|".join(rf"(?<!\d){re.escape(c)}(?!\d)" if c.isdigit() else re.escape(c) for c in codes)
        code_pattern = re.compile(body, re.I)
    return (phrase_pattern, code_pattern), sources


# ---------------------------------------------------------------- scanning

class Scanner:
    def __init__(self) -> None:
        self.private, self.sources = load_private_terms()
        self.problems: list[str] = []

    def report(self, where: str, what: str) -> None:
        self.problems.append(f"  {where}: {what}")

    def mask(self, text: str) -> str:
        return text[:2] + "…" if IN_CI else text

    def scan_text(self, where: str, text: str) -> None:
        for number, line in enumerate(text.splitlines(), 1):
            for finding in generic_findings(line):
                self.report(f"{where}:{number}", finding)
            phrases, codes = self.private
            hits = {m.group(0) for m in phrases.finditer(line)} if phrases else set()
            if codes:
                hits |= {m.group(0) for m in codes.finditer(line)}
                hits |= {m.group(0) for m in codes.finditer(re.sub(r"[\s\-]", "", line))}
            for term in sorted(hits):
                self.report(f"{where}:{number}", f"private term '{self.mask(term)}' (real firm or party data)")

    def scan_file(self, path: str, data: bytes) -> None:
        self.scan_text(f"{path} (file name)", path)
        lower = path.lower()
        allowed = any(p.search(path) for p in ALLOWED_BINARIES)
        if FORBIDDEN_NAMES.search(path):
            self.report(path, "the real data or config file")
            return
        if not allowed and (Path(lower).suffix in FORBIDDEN_EXTENSIONS or lower.endswith("~")):
            self.report(path, f"{Path(lower).suffix or 'this'} files may hold real data and are never committed")
            return
        if lower.endswith(".db"):
            self.scan_database(path, data)
            return
        if b"\0" in data[:8000]:
            if not allowed:
                self.report(path, "a binary file; add it to ALLOWED_BINARIES only after checking it holds no real data")
            return
        self.scan_text(path, data.decode("utf-8", "replace"))

    def scan_database(self, path: str, data: bytes) -> None:
        with tempfile.TemporaryDirectory() as folder:
            copy = Path(folder) / "check.db"
            copy.write_bytes(data)
            try:
                db = sqlite3.connect(copy)
                tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
                for table in tables:
                    for row in db.execute(f'SELECT * FROM "{table}"'):
                        for value in row:
                            if isinstance(value, bytes):
                                if len(value) > 200:
                                    self.report(f"{path} [{table}]", "a large blob (a picture?) in the fixture")
                            elif isinstance(value, str):
                                self.scan_text(f"{path} [{table}]", value)
                db.close()
            except sqlite3.Error as error:
                self.report(path, f"cannot read the database ({error})")

    def finish(self, what: str) -> int:
        if self.private == (None, None):
            print("privacy: warning: no private data found on this machine (config, data file, workbooks); "
                  "only the generic rules ran.", file=sys.stderr)
        if self.problems:
            print(f"privacy: refused {what}: real firm or party data must never reach git. Use test data "
                  "(English names such as THOMAS MILLS, TEST… GSTINs; see scripts/privacy_check.py).", file=sys.stderr)
            seen = set()
            for problem in self.problems:
                if problem not in seen:
                    seen.add(problem)
                    print(problem, file=sys.stderr)
            return 1
        print(f"privacy: {what} is clean.")
        return 0


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], capture_output=True, check=True).stdout


def blob_reader():
    process = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def read(spec: str) -> bytes | None:
        process.stdin.write(spec.encode() + b"\n")
        process.stdin.flush()
        header = process.stdout.readline().split()
        if len(header) < 3 or header[1] == b"missing":
            return None
        data = process.stdout.read(int(header[2]))
        process.stdout.read(1)
        return data

    return read


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--staged", action="store_true")
    group.add_argument("--message")
    group.add_argument("--commits")
    group.add_argument("--tree")
    group.add_argument("--text")
    group.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    if args.refresh:
        refresh_cache()
        return 0
    if args.message:
        args.message = str(Path(args.message).resolve())
    os.chdir(git("rev-parse", "--show-toplevel").decode().strip())
    scanner = Scanner()
    read = blob_reader()
    if args.message:
        text = Path(args.message).read_text(encoding="utf-8", errors="replace")
        scanner.scan_text("commit message", "\n".join(l for l in text.splitlines() if not l.startswith("#")))
        return scanner.finish("the commit message")
    if args.text is not None:
        scanner.scan_text("text", args.text)
        return scanner.finish("the text")
    if args.staged:
        names = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").decode().split("\0")
        for name in filter(None, names):
            data = read(f":{name}")
            if data is not None:
                scanner.scan_file(name, data)
        return scanner.finish("the commit")
    if args.commits:
        commits = git("rev-list", *args.commits.split()).decode().split()
        for commit in commits:
            scanner.scan_text(f"message of {commit[:9]}", git("log", "-1", "--format=%B", commit).decode())
            names = git("diff-tree", "--root", "-r", "--no-commit-id", "--name-only", "--diff-filter=ACMR", "-z",
                        commit).decode().split("\0")
            for name in filter(None, names):
                data = read(f"{commit}:{name}")
                if data is not None:
                    scanner.scan_file(name, data)
        return scanner.finish(f"{len(commits)} commit(s)")
    rev = args.tree
    names = git(*(["ls-tree", "-r", "--name-only", "-z", rev] if rev else ["ls-files", "-z"])).decode().split("\0")
    for name in filter(None, names):
        if rev:
            data = read(f"{rev}:{name}")
        else:
            path = Path(name)
            data = path.read_bytes() if path.is_file() else None
        if data is not None:
            scanner.scan_file(name, data)
    return scanner.finish(f"the tree at {rev}" if rev else "the working tree")


if __name__ == "__main__":
    sys.exit(main())
