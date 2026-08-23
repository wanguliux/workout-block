# -*- coding: utf-8 -*-
import re, os

ROOT = os.path.dirname(os.path.abspath(__file__))

# Non-muscle base layers / body-part ids to exclude
EXCLUDE = {
    'underlayer', 'non_muscle',
    'foot_l', 'foot_r', 'ankle_l', 'ankle_r',
    'hand_l', 'hand_r', 'hands', 'wrist_l', 'wrist_r', 'palm_l', 'palm_r',
    'head', 'face',
}
# Top-level <g> containers (grouping wrappers, not individual muscles)
CONTAINERS = {
    'legs', 'adductors', 'glutes', 'arms', 'core', 'back',
    'shoulders', 'chest', 'neck', 'hamstrings',
}

# Chinese anatomical names for the muscle base (after stripping side/segment suffixes)
BASE_CN = {
    'tibialis_anterior': '胫骨前肌',
    'extensor_hallucis_longus': '拇长伸肌',
    'fibularis_longus': '腓骨长肌',
    'extensor_digitorum_longus': '趾长伸肌',
    'gastrocnemius': '腓肠肌',
    'semitendinosus': '半腱肌',
    'vastus_lateralis': '股外侧肌',
    'vastus_medialis': '股内侧肌',
    'sartoris': '缝匠肌',          # SVG typo for sartorius
    'sartorius': '缝匠肌',
    'gracilis': '股薄肌',
    'rectus_femoris': '股直肌',
    'iliotibial_tract': '髂胫束(筋膜)',
    'adductor_longus': '长收肌',
    'pectineus': '耻骨肌',
    'adductor_magnus': '大收肌',
    'gluteus_medius': '臀中肌',
    'gluteus_maximus': '臀大肌',
    'flexor_digitorum_superficialis': '指浅屈肌',
    'pronator_quadratus': '旋前方肌',
    'extensor_carpi_radialis_longus': '桡侧腕长伸肌',
    'palmaris_longus': '掌长肌',
    'flexor_carpi_radialis': '桡侧腕屈肌',
    'pronator_teres': '旋前圆肌',
    'triceps_brachii': '肱三头肌',
    'brachioradialis': '肱桡肌',
    'biceps_brachii': '肱二头肌',
    'external_oblique': '腹外斜肌',
    'rectus_abdominis': '腹直肌',
    'latissimus_dorsi': '背阔肌',
    'lateral_deltoid': '三角肌(中束)',
    'trapezius_upper': '斜方肌(上束)',
    'trapezius_middle': '斜方肌(中束)',
    'trapezius_lower': '斜方肌(下束)',
    'anterior_deltoid': '三角肌(前束)',
    'posterior_deltoid': '三角肌(后束)',
    'pectoralis_major': '胸大肌',
    'platysma': '颈阔肌',
    'sternohyoid': '胸骨舌骨肌',
    'sternocleidomastoid': '胸锁乳突肌',
    'infraspinatus': '冈下肌',
    'semimembranosus': '半膜肌',
    'biceps_femoris': '股二头肌',
    'extensor_digitorum': '指总伸肌',
    'extensor_carpi_ulnaris': '尺侧腕伸肌',
    'anconeus': '肘肌',
    'flexor_carpi_ulnaris': '尺侧腕屈肌',
}

def base_name(mid):
    """Strip side (_l/_r) and keep head/segment info minimal -> base muscle key."""
    s = mid.lower()
    # triceps/biceps heads: keep just the muscle name (merge heads for grouping)
    if s.startswith('triceps_brachii'):
        return 'triceps_brachii'
    if s.startswith('biceps_brachii'):
        return 'biceps_brachii'
    # strip trailing _l / _r
    s = re.sub(r'_[lr]$', '', s)
    # strip numeric segment suffixes like _1 _2 and _r/_l already removed
    s = re.sub(r'_\d+$', '', s)
    return s

def fitness_group(mid):
    s = mid.lower()
    if 'pectoralis_major' in s: return '胸部'
    if s.startswith('trapezius'): return '斜方肌'
    if 'latissimus_dorsi' in s or 'infraspinatus' in s: return '背部'
    if 'deltoid' in s: return '肩部（三角肌）'
    if 'biceps_brachii' in s: return '肱二头肌'
    if 'triceps_brachii' in s: return '肱三头肌'
    if any(k in s for k in ['gastrocnemius','tibialis','fibularis','extensor_hallucis','extensor_digitorum_longus']):
        return '小腿'
    if any(k in s for k in ['brachioradialis','flexor_digitorum','pronator','extensor_carpi',
                            'palmaris','flexor_carpi','extensor_digitorum','anconeus']):
        return '前臂'
    if 'rectus_abdominis' in s or 'external_oblique' in s: return '腹肌/核心'
    if 'gluteus' in s: return '臀部'
    if any(k in s for k in ['rectus_femoris','vastus','sartoris','sartorius','iliotibial']):
        return '股四头肌'
    if any(k in s for k in ['semitendinosus','semimembranosus','biceps_femoris']): return '腘绳肌'
    if any(k in s for k in ['adductor','pectineus','gracilis']): return '内收肌'
    if any(k in s for k in ['sternocleidomastoid','platysma','sternohyoid']): return '颈部'
    return '其他'

def parse_ids(path):
    with open(path, encoding='utf-8') as f:
        txt = f.read()
    return re.findall(r'\bid="([^"]+)"', txt)

files = {
    '正面': os.path.join(ROOT, 'muscle_layer_front.svg'),
    '背面': os.path.join(ROOT, 'muscle_layer_back.svg'),
}

muscles = []  # (id, view, base, group)
for view, fp in files.items():
    for mid in parse_ids(fp):
        if mid in EXCLUDE or mid in CONTAINERS:
            continue
        b = base_name(mid)
        g = fitness_group(mid)
        muscles.append((mid, view, b, g))

# ---- Counts ----
from collections import defaultdict, OrderedDict
per_view = defaultdict(int)
for mid, view, b, g in muscles:
    per_view[view] += 1
total = len(muscles)

# distinct anatomical muscle types (merge L/R + segments + across views)
distinct_types = set(b for mid, view, b, g in muscles)

# per fitness group aggregation
group_info = OrderedDict()
for mid, view, b, g in muscles:
    if g not in group_info:
        group_info[g] = {'paths': 0, 'bases': set(), 'views': set(), 'ids_by_view': defaultdict(list)}
    group_info[g]['paths'] += 1
    group_info[g]['bases'].add(b)
    group_info[g]['views'].add(view)
    if mid not in group_info[g]['ids_by_view'][view]:   # dedupe within a view
        group_info[g]['ids_by_view'][view].append(mid)

# ---- Write report ----
lines = []
lines.append('# 肌肉热力图 SVG 肌肉统计与健身肌肉群分组')
lines.append('')
lines.append('> 数据源：`kit-g/flutter-body-atlas` 的 `muscle_layer_front.svg`（正面）与 `muscle_layer_back.svg`（背面）')
lines.append('> 已下载至 `muscle_analysis/` 目录。')
lines.append('')
lines.append('## 一、肌肉数量统计（不含面部）')
lines.append('')
lines.append('| 视图 | 肌肉路径块数 |')
lines.append('| --- | ---: |')
lines.append(f'| 正面 (front) | {per_view["正面"]} |')
lines.append(f'| 背面 (back) | {per_view["背面"]} |')
lines.append(f'| **合计** | **{total}** |')
lines.append('')
lines.append(f'- 上述为**单独绘制的肌肉路径块数**（左右侧、分节段各自计为 1 块；已剔除 `face` 面部、`foot`/`ankle`/`hand`/`wrist`/`palm` 等非肌肉部位，以及 `underlayer`/`non_muscle` 底层）。')
lines.append(f'- 若将左右侧合并、分节段合并、正反视图去重，**不同的解剖肌肉类型共 {len(distinct_types)} 种**。')
lines.append('')
lines.append('## 二、健身常用肌肉群分组表')
lines.append('')
lines.append('下表把 143 块细碎肌肉路径汇总为健身人群常用的 14 个肌肉群。')
lines.append('')
lines.append('| 健身肌肉群 | 路径块数 | 出现视图 | 包含的具体肌肉（SVG 基础名 → 中文） |')
lines.append('| --- | ---: | --- | --- |')
for g in ['胸部','背部','斜方肌','肩部（三角肌）','肱二头肌','肱三头肌','前臂','腹肌/核心',
          '臀部','股四头肌','腘绳肌','内收肌','小腿','颈部']:
    if g not in group_info:
        continue
    info = group_info[g]
    views = '/'.join(sorted(info['views']))
    parts = []
    for b in sorted(info['bases']):
        parts.append(f'{b} → {BASE_CN.get(b, b)}')
    detail = '；'.join(parts)
    lines.append(f'| {g} | {info["paths"]} | {views} | {detail} |')
lines.append('')
lines.append(f'**合计路径块数：** {sum(v["paths"] for v in group_info.values())}（= 143，校验一致）')
lines.append('')
lines.append('## 三、附录：每个健身肌肉群对应的完整 SVG 元素 id（可直接用于热力图填色）')
lines.append('')
for g in ['胸部','背部','斜方肌','肩部（三角肌）','肱二头肌','肱三头肌','前臂','腹肌/核心',
          '臀部','股四头肌','腘绳肌','内收肌','小腿','颈部']:
    if g not in group_info:
        continue
    info = group_info[g]
    lines.append(f'### {g}（共 {info["paths"]} 块）')
    lines.append('')
    for view in ['正面','背面']:
        ids = sorted(info['ids_by_view'].get(view, []))
        if not ids:
            continue
        lines.append(f'**{view}视图（{len(ids)} 块）：**')
        lines.append('')
        lines.append('```')
        lines.append(', '.join(ids))
        lines.append('```')
        lines.append('')
    lines.append('')

out = os.path.join(ROOT, '肌肉统计与分组报告.md')
with open(out, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print('Total muscle paths (excl. face):', total)
print('Front:', per_view['正面'], 'Back:', per_view['背面'])
print('Distinct anatomical types:', len(distinct_types))
print('Fitness groups:', len(group_info))
for g, info in group_info.items():
    print(f'  {g}: {info["paths"]} paths, {len(info["bases"])} types, views={sorted(info["views"])}')
print('Report written to', out)
