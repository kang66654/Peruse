import re
import os

root = r"C:\Users\kangy\Desktop\Peruse项目\peruse-extension"

for name in ["README.md", "README.zh-CN.md"]:
    path = os.path.join(root, name)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    print("==", name)
    # markdown images ![alt](path) and html/raw links src="path" href="path"
    refs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", text)
    refs += re.findall(r'(?:src|href)="([^"]+)"', text)
    refs += re.findall(r"\]\(\./([^)]+)\)", text)
    for r in sorted(set(refs)):
        if r.startswith(("http://", "https://", "#", "mailto:")):
            continue
        p = os.path.join(root, r)
        print(("OK   " if os.path.exists(p) else "MISS ") + r)
    # leftover placeholders
    for token in ["<your-username>"]:
        if token in text:
            print("PLACEHOLDER present:", token, "×", text.count(token))
