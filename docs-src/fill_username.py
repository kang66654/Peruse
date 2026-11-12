import os

ROOT = r"C:\Users\kangy\Desktop\Peruse项目\peruse-extension"
USER = "kang66654"
REPO = "Peruse"

files = [
    "README.md",
    "README.zh-CN.md",
    "docs-src/social.html",
    "package.json",
]

for rel in files:
    path = os.path.join(ROOT, rel)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    before = text.count("<your-username>")
    text = text.replace("github.com/<your-username>/peruse", f"github.com/{USER}/{REPO}")
    text = text.replace("<your-username>", USER)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    after = text.count("<your-username>")
    print(f"{rel}: replaced {before - after} placeholder(s), remaining {after}")

print("\nremaining occurrences across repo root docs:")
for rel in files:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        if "<your-username>" in f.read():
            print("  still present in", rel)
