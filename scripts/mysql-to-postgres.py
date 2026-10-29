"""Convert the CRM's MySQL migrations to PostgreSQL.

Mechanical, deliberately: 1,590 lines retyped by hand is 1,590 chances to drop a
column. The rules below are reviewable in one screen; the output is then proved
by applying it to a real Postgres and diffing the table/column inventory against
the MySQL source.

Decisions worth stating:

* CHAR(n) becomes varchar(n), NOT uuid. Postgres rejects a malformed uuid with
  an error where MySQL simply matches nothing, so a lookup by a bad id would
  turn a clean 404 into a 500. varchar keeps today's behaviour exactly.
* TINYINT(1) becomes smallint, not boolean. The code reads and writes 0 and 1 in
  939 places; boolean would mean changing every one of them.
* ENUM becomes text + CHECK, not a Postgres enum type. Same values enforced, and
  adding one later is an ordinary migration rather than ALTER TYPE.
* ON UPDATE CURRENT_TIMESTAMP has no Postgres equivalent, so each table that had
  it gets a trigger.
"""
import re
import sys
from pathlib import Path

SRC = Path("server/migrations")
DST = Path("server/migrations-pg")

TYPES = [
    (r"\bBIGINT\s+UNSIGNED\b", "bigint"),
    (r"\bINT\s+UNSIGNED\b", "bigint"),
    (r"\bINTEGER\s+UNSIGNED\b", "bigint"),
    (r"\bSMALLINT\s+UNSIGNED\b", "integer"),
    (r"\bTINYINT\s+UNSIGNED\b", "smallint"),
    (r"\bTINYINT\(\d+\)", "smallint"),
    (r"\bTINYINT\b", "smallint"),
    (r"\bDATETIME\(3\)", "timestamptz(3)"),
    (r"\bDATETIME\b", "timestamptz"),
    (r"\bLONGTEXT\b", "text"),
    (r"\bMEDIUMTEXT\b", "text"),
    (r"\bJSON\b", "jsonb"),
    (r"\bDECIMAL\(", "numeric("),
    (r"\bCHAR\((\d+)\)", r"varchar(\1)"),
]

# A column line carrying an ENUM, e.g.
#   role ENUM('owner','admin') NOT NULL DEFAULT 'agent',
ENUM_RE = re.compile(
    r"^(?P<indent>\s*)(?P<col>[A-Za-z_][A-Za-z0-9_]*)\s+ENUM\((?P<vals>[^)]*)\)(?P<rest>.*)$",
    re.IGNORECASE,
)
# Same, but as `ADD COLUMN x ENUM(...)` inside an ALTER.
ADD_ENUM_RE = re.compile(
    r"^(?P<indent>\s*)(?P<add>ADD\s+COLUMN\s+)(?P<col>[A-Za-z_][A-Za-z0-9_]*)\s+ENUM\((?P<vals>[^)]*)\)(?P<rest>.*)$",
    re.IGNORECASE,
)
UNIQUE_KEY_RE = re.compile(r"^(\s*)UNIQUE\s+KEY\s+(\w+)\s+\((.*?)\)(,?)\s*$", re.IGNORECASE)
KEY_RE = re.compile(r"^(\s*)KEY\s+(\w+)\s+\((.*?)\)(,?)\s*$", re.IGNORECASE)
CREATE_RE = re.compile(r"^CREATE\s+TABLE\s+(\w+)", re.IGNORECASE)
ALTER_RE = re.compile(r"^ALTER\s+TABLE\s+(\w+)", re.IGNORECASE)
ALTER_STMT_RE = re.compile(r"ALTER\s+TABLE\s+(\w+)(.*?);", re.IGNORECASE | re.DOTALL)


def split_clauses(body: str):
    """Split an ALTER body on its top-level commas, ignoring those inside ()."""
    out, depth, current = [], 0, ""
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(current)
            current = ""
        else:
            current += ch
    if current.strip():
        out.append(current)
    return out


def rewrite_alters(text: str, indexes: list) -> str:
    """
    MySQL declares indexes inside ALTER TABLE; Postgres wants CREATE INDEX.

    Done on whole statements rather than line by line because a clause can end
    in a semicolon rather than a comma, and because these bodies carry comments
    whose prose contains commas — splitting naively would cut one in half.
    """
    # Comments are masked first. These bodies carry prose, and prose contains
    # both commas and semicolons — one comment here reads "deleting; an archived
    # project", which cut a statement in half at the semicolon.
    masked: list = []

    def hide(m: "re.Match[str]") -> str:
        masked.append(m.group(0))
        return f"--@@{len(masked) - 1}@@"

    text = re.sub(r"--[^\n]*", hide, text)

    def repl(m: "re.Match[str]") -> str:
        table, body = m.group(1), m.group(2)
        comments = [ln for ln in body.split("\n") if ln.strip().startswith("--")]
        code = "\n".join(ln for ln in body.split("\n") if not ln.strip().startswith("--"))

        keep = []
        for clause in split_clauses(code):
            stripped = clause.strip()
            if not stripped:
                continue
            km = re.match(r"ADD\s+(UNIQUE\s+)?KEY\s+(\w+)\s+\((.*)\)$", stripped, re.IGNORECASE | re.DOTALL)
            if km:
                unique = "UNIQUE " if km.group(1) else ""
                indexes.append(
                    f"CREATE {unique}INDEX {km.group(2)} ON {table} ({strip_prefix_lengths(km.group(3))});"
                )
            else:
                keep.append(stripped)

        head = ("\n".join(comments) + "\n") if comments else ""
        if not keep:
            return head.rstrip("\n")
        return head + f"ALTER TABLE {table}\n  " + ",\n  ".join(keep) + ";"

    text = ALTER_STMT_RE.sub(repl, text)
    return re.sub(r"--@@(\d+)@@", lambda m: masked[int(m.group(1))], text)


def strip_prefix_lengths(cols: str) -> str:
    """`token(191)` is a MySQL prefix index; Postgres indexes the whole column."""
    return re.sub(r"\((\d+)\)", "", cols)


def convert(text: str) -> str:
    out, indexes, touched = [], [], []
    table = None

    # A long ENUM wraps across lines in the source. Collapse each onto one line
    # so the column rules below, which work line by line, can see all of it.
    text = re.sub(
        r"ENUM\s*\(([^)]*)\)",
        lambda m: "ENUM(" + " ".join(m.group(1).split()) + ")",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    for raw in text.split("\n"):
        line = raw

        m = CREATE_RE.match(line.strip())
        if m:
            table = m.group(1)
        m = ALTER_RE.match(line.strip())
        if m:
            table = m.group(1)

        # Engine/charset tail: Postgres has none.
        line = re.sub(r"\)\s*ENGINE=\w+.*?;", ");", line, flags=re.IGNORECASE)
        # MySQL quotes identifiers with backticks.
        line = line.replace("`", '"')

        if re.search(r"ON\s+UPDATE\s+CURRENT_TIMESTAMP(\(\d\))?", line, re.IGNORECASE):
            if table and table not in touched:
                touched.append(table)
            line = re.sub(r"\s*ON\s+UPDATE\s+CURRENT_TIMESTAMP(\(\d\))?", "", line, flags=re.IGNORECASE)

        line = re.sub(r"DEFAULT\s+CURRENT_TIMESTAMP(\(\d\))?", "DEFAULT now()", line, flags=re.IGNORECASE)

        # An auto-increment primary key becomes an identity column.
        line = re.sub(
            r"\bBIGINT\s+UNSIGNED\s+NOT\s+NULL\s+AUTO_INCREMENT\b",
            "bigint GENERATED ALWAYS AS IDENTITY",
            line,
            flags=re.IGNORECASE,
        )
        line = re.sub(r"\s*AUTO_INCREMENT\b", "", line, flags=re.IGNORECASE)

        # ENUM -> text + CHECK, both as a column and inside an ALTER.
        m = ADD_ENUM_RE.match(line)
        if m:
            tail = m.group("rest").rstrip()
            comma = tail.endswith(",")
            if comma:
                tail = tail[:-1]
            line = (f'{m.group("indent")}{m.group("add")}{m.group("col")} text{tail}'
                    f' CHECK ({m.group("col")} IN ({m.group("vals")})){"," if comma else ""}')
        else:
            m = ENUM_RE.match(line)
            if m:
                tail = m.group("rest").rstrip()
                comma = tail.endswith(",")
                if comma:
                    tail = tail[:-1]
                line = (f'{m.group("indent")}{m.group("col")} text{tail}'
                        f' CHECK ({m.group("col")} IN ({m.group("vals")})){"," if comma else ""}')

        for pattern, repl in TYPES:
            line = re.sub(pattern, repl, line, flags=re.IGNORECASE)

        # AFTER <col> is MySQL's column ordering; Postgres appends.
        line = re.sub(r"\s+AFTER\s+\"?\w+\"?", "", line, flags=re.IGNORECASE)

        # Index clauses inside CREATE TABLE. The ALTER TABLE ones are handled
        # afterwards, on whole statements.
        m = UNIQUE_KEY_RE.match(line)
        if m:
            line = f'{m.group(1)}CONSTRAINT {m.group(2)} UNIQUE ({strip_prefix_lengths(m.group(3))}){m.group(4)}'
        else:
            m = KEY_RE.match(line)
            if m:
                indexes.append(f'CREATE INDEX {m.group(2)} ON {table} ({strip_prefix_lengths(m.group(3))});')
                line = None

        if line is not None:
            out.append(line)

    text = "\n".join(out)
    # A removed KEY line can leave `,\n)` — Postgres will not have it.
    text = re.sub(r",(\s*\n\s*)\)", r"\1)", text)
    text = rewrite_alters(text, indexes)

    if indexes:
        text += "\n\n-- Indexes (MySQL declares these inside CREATE TABLE).\n" + "\n".join(indexes) + "\n"
    if touched:
        text += (
            "\n-- MySQL refreshes updated_at by itself; Postgres needs to be asked.\n"
            + "\n".join(
                f"CREATE TRIGGER {t}_set_updated_at BEFORE UPDATE ON {t}\n"
                f"  FOR EACH ROW EXECUTE FUNCTION set_updated_at();"
                for t in touched
            )
            + "\n"
        )
    return text


def main() -> int:
    DST.mkdir(exist_ok=True)
    for path in sorted(SRC.glob("*.sql")):
        (DST / path.name).write_text(convert(path.read_text()))
        print(f"  {path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
