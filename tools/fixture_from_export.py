"""Превращает выгрузку таблицы («## Sheet name: …» + CSV) в local/tables.json для локальной проверки.
local/ не попадает в репозиторий: там настоящие данные проекта."""
import csv, io, json, re, sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
tables = {}
for block in re.split(r'^## Sheet name: ', src, flags=re.M)[1:]:
    name, _, body = block.partition('\n')
    rows = [r for r in csv.reader(io.StringIO(body.strip())) if any(c.strip() for c in r)]
    tables[name.strip()] = rows
out = pathlib.Path(__file__).resolve().parent.parent / 'local' / 'tables.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(tables, ensure_ascii=False, indent=1), encoding='utf-8')
print(out, {k: len(v) - 1 for k, v in tables.items()})
