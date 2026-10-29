# -*- coding: utf-8 -*-
"""一次性脚本：把仓库（含 docs/lib/test 源码与注释）里的真实测试数据替换为通用占位数据。
只处理仓库源文件，release/ 镜像由 build-dist 重建。每个映射打印命中次数，0 命中报警。"""
import os, sys

ROOT = r'D:\Kimi\开发\dsh-privacy-shield'
EXTS = ('.md', '.js', '.mjs', '.yml', '.json')

# 顺序敏感：长的、含子串的在前
MAPPING = [
    # 公司真名
    ('慧盾信息安全科技（北京）有限公司', '辰星信息安全科技（北京）有限公司'),
    ('国信金宏北分', '蓝鸟北分'),
    ('国信金宏', '蓝鸟'),
    # 真实政府机构客户
    ('北京市新闻出版局（北京市版权局）', '某某市新闻出版局（某某市版权局）'),
    ('北京市版权局', '某某市版权局'),
    ('北京市海淀区退役军人事务局', '某某市某区退役军人事务局'),
    ('北京市大兴区经济和信息化局', '某某市某区经济和信息化局'),
    ('北京市大兴区财政局', '某某市某区财政局'),
    ('北京市大兴区委社工委区民政局', '某某市某区委社工委区民政局'),
    # 真实项目名
    ('海淀区退役军人服务大厅设备及服务平台建设', '某某区政务服务大厅设备及平台建设'),
    ('海淀区智慧人大建设项目', '某某区智慧政务建设项目'),
    ('配电工程设计辅助系统2021', '配网工程设计辅助系统2021'),
    ('生产运检业务管控平台', '生产运营业务管控平台'),
    ('\u201c热线+网格\u201d融合提升项目', '\u201c热线+网格\u201d融合提升项目'),  # 占位防误配
    ('大兴区\u201c热线+网格\u201d融合提升项目', '某区\u201c热线+网格\u201d融合提升项目'),
    # 真实合同编号（先数字后前缀）
    ('2020145', '2020001'),
    ('2020147', '2020002'),
    ('2021092', '2020003'),
    ('2021153', '2020004'),
    ('2021177', '2020005'),
    ('2020110', '2020006'),
    ('2021065', '2020007'),
    ('2021127', '2020008'),
    ('2021061', '2020009'),
    ('2021001', '2020010'),
    ('GXJH', 'XMHT'),
    ('gxjh', 'xmht'),
    ('北分-', '京分-'),
    # 真实人名
    ('李千目', '孙明'),
    ('袁宏生', '王磊'),
    ('袁礼', '陈静'),
    ('刘哲', '刘洋'),
    ('顾涛', '赵敏'),
    ('陈琦', '李芳'),
    ('李刚', '张伟'),
    # 真实金额
    ('693466', '128600'),
    ('157566', '96420'),
    ('34076', '45820'),
    ('4104586', '864200'),
    ('94.46', '36.50'),
    ('192516', '2024001'),
    # 会话/项目专名
    ('session-b2cce24f', 'session-xxxxxxxx'),
    ('智慧水务', '智慧园区'),
    ('星河智联', '星联智造'),
    ('天枢', '蓝鸟'),
    ('机房改造', '机房升级'),
    ('真实样本 `测试数据.xlsx`（166 行 × 15 列）', '样例业务表格（百余行 × 十余列）'),
]

counts = {old: 0 for old, _ in MAPPING}
changed_files = []

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in ('.git', 'node_modules', 'release')]
    for fn in filenames:
        if not fn.endswith(EXTS):
            continue
        path = os.path.join(dirpath, fn)
        with open(path, 'r', encoding='utf-8') as f:
            text = f.read()
        new = text
        for old, repl in MAPPING:
            n = new.count(old)
            if n:
                counts[old] += n
                new = new.replace(old, repl)
        if new != text:
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write(new)
            changed_files.append(os.path.relpath(path, ROOT))

print('changed files:')
for p in changed_files:
    print(' ', p)
print('\nzero-hit mappings (check!):')
bad = [old for old, c in counts.items() if c == 0]
for old in bad:
    print(' !! 0 hits:', old)
print('\ntotal replacements:', sum(counts.values()))
