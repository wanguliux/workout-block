# -*- coding: utf-8 -*-
import re
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

EXCLUDE = {
    'underlayer', 'non_muscle',
    'foot_l', 'foot_r', 'ankle_l', 'ankle_r',
    'hand_l', 'hand_r', 'hands', 'wrist_l', 'wrist_r', 'palm_l', 'palm_r',
    'head', 'face',
}
CONTAINERS = {
    'legs', 'adductors', 'glutes', 'arms', 'core', 'back',
    'shoulders', 'chest', 'neck', 'hamstrings',
}

BASE_CN = {
    'tibialis_anterior': '胫骨前肌',
    'extensor_hallucis_longus': '拇长伸肌',
    'fibularis_longus': '腓骨长肌',
    'extensor_digitorum_longus': '趾长伸肌',
    'gastrocnemius': '腓肠肌',
    'semitendinosus': '半腱肌',
    'vastus_lateralis': '股外侧肌',
    'vastus_medialis': '股内侧肌',
    'sartoris': '缝匠肌',
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

BASE_EN = {
    'tibialis_anterior': 'Tibialis Anterior',
    'extensor_hallucis_longus': 'Extensor Hallucis Longus',
    'fibularis_longus': 'Fibularis Longus',
    'extensor_digitorum_longus': 'Extensor Digitorum Longus',
    'gastrocnemius': 'Gastrocnemius',
    'semitendinosus': 'Semitendinosus',
    'vastus_lateralis': 'Vastus Lateralis',
    'vastus_medialis': 'Vastus Medialis',
    'sartoris': 'Sartorius',
    'sartorius': 'Sartorius',
    'gracilis': 'Gracilis',
    'rectus_femoris': 'Rectus Femoris',
    'iliotibial_tract': 'Iliotibial Tract',
    'adductor_longus': 'Adductor Longus',
    'pectineus': 'Pectineus',
    'adductor_magnus': 'Adductor Magnus',
    'gluteus_medius': 'Gluteus Medius',
    'gluteus_maximus': 'Gluteus Maximus',
    'flexor_digitorum_superficialis': 'Flexor Digitorum Superficialis',
    'pronator_quadratus': 'Pronator Quadratus',
    'extensor_carpi_radialis_longus': 'Extensor Carpi Radialis Longus',
    'palmaris_longus': 'Palmaris Longus',
    'flexor_carpi_radialis': 'Flexor Carpi Radialis',
    'pronator_teres': 'Pronator Teres',
    'triceps_brachii': 'Triceps Brachii',
    'brachioradialis': 'Brachioradialis',
    'biceps_brachii': 'Biceps Brachii',
    'external_oblique': 'External Oblique',
    'rectus_abdominis': 'Rectus Abdominis',
    'latissimus_dorsi': 'Latissimus Dorsi',
    'lateral_deltoid': 'Deltoid (Lateral)',
    'trapezius_upper': 'Trapezius (Upper)',
    'trapezius_middle': 'Trapezius (Middle)',
    'trapezius_lower': 'Trapezius (Lower)',
    'anterior_deltoid': 'Deltoid (Anterior)',
    'posterior_deltoid': 'Deltoid (Posterior)',
    'pectoralis_major': 'Pectoralis Major',
    'platysma': 'Platysma',
    'sternohyoid': 'Sternohyoid',
    'sternocleidomastoid': 'Sternocleidomastoid',
    'infraspinatus': 'Infraspinatus',
    'semimembranosus': 'Semimembranosus',
    'biceps_femoris': 'Biceps Femoris',
    'extensor_digitorum': 'Extensor Digitorum',
    'extensor_carpi_ulnaris': 'Extensor Carpi Ulnaris',
    'anconeus': 'Anconeus',
    'flexor_carpi_ulnaris': 'Flexor Carpi Ulnaris',
}

GROUP_ZH_TO_KEY = {
    '胸部': 'chest',
    '背部': 'back',
    '斜方肌': 'traps',
    '肩部（三角肌）': 'shoulders',
    '肱二头肌': 'biceps',
    '肱三头肌': 'triceps',
    '前臂': 'forearms',
    '腹肌/核心': 'abs',
    '臀部': 'glutes',
    '股四头肌': 'quads',
    '腘绳肌': 'hamstrings',
    '内收肌': 'adductors',
    '小腿': 'calves',
    '颈部': 'neck',
}

GROUP_KEY_TO_EN = {
    'chest': 'Chest',
    'back': 'Back',
    'traps': 'Traps',
    'shoulders': 'Shoulders (Delts)',
    'biceps': 'Biceps',
    'triceps': 'Triceps',
    'forearms': 'Forearms',
    'abs': 'Abs / Core',
    'glutes': 'Glutes',
    'quads': 'Quads',
    'hamstrings': 'Hamstrings',
    'adductors': 'Adductors',
    'calves': 'Calves',
    'neck': 'Neck',
}


def base_name(mid):
    s = mid.lower()
    if s.startswith('triceps_brachii'):
        return 'triceps_brachii'
    if s.startswith('biceps_brachii'):
        return 'biceps_brachii'
    s = re.sub(r'_[lr]$', '', s)
    s = re.sub(r'_\d+$', '', s)
    return s


def fitness_group(mid):
    s = mid.lower()
    if 'pectoralis_major' in s:
        return '胸部'
    if s.startswith('trapezius'):
        return '斜方肌'
    if 'latissimus_dorsi' in s or 'infraspinatus' in s:
        return '背部'
    if 'deltoid' in s:
        return '肩部（三角肌）'
    if 'biceps_brachii' in s:
        return '肱二头肌'
    if 'triceps_brachii' in s:
        return '肱三头肌'
    if any(k in s for k in ['gastrocnemius', 'tibialis', 'fibularis', 'extensor_hallucis', 'extensor_digitorum_longus']):
        return '小腿'
    if any(k in s for k in ['brachioradialis', 'flexor_digitorum', 'pronator', 'extensor_carpi',
                            'palmaris', 'flexor_carpi', 'extensor_digitorum', 'anconeus']):
        return '前臂'
    if 'rectus_abdominis' in s or 'external_oblique' in s:
        return '腹肌/核心'
    if 'gluteus' in s:
        return '臀部'
    if any(k in s for k in ['rectus_femoris', 'vastus', 'sartoris', 'sartorius', 'iliotibial']):
        return '股四头肌'
    if any(k in s for k in ['semitendinosus', 'semimembranosus', 'biceps_femoris']):
        return '腘绳肌'
    if any(k in s for k in ['adductor', 'pectineus', 'gracilis']):
        return '内收肌'
    if any(k in s for k in ['sternocleidomastoid', 'platysma', 'sternohyoid']):
        return '颈部'
    return '其他'


def parse_ids(path):
    with open(path, encoding='utf-8') as f:
        txt = f.read()
    return re.findall(r'\bid="([^"]+)"', txt)


files = {
    'front': os.path.join(ROOT, 'muscle_layer_front.svg'),
    'back': os.path.join(ROOT, 'muscle_layer_back.svg'),
}

entries = []
for side, fp in files.items():
    for mid in parse_ids(fp):
        if mid in EXCLUDE or mid in CONTAINERS:
            continue
        b = base_name(mid)
        g_zh = fitness_group(mid)
        g_key = GROUP_ZH_TO_KEY.get(g_zh, 'other')
        entries.append({
            'id': mid,
            'side': side,
            'fitnessGroup': g_key,
            'zh': BASE_CN.get(b, b),
            'en': BASE_EN.get(b, b),
        })

entries.sort(key=lambda x: (x['side'], x['fitnessGroup'], x['id']))

lines = []
lines.append('/*')
lines.append(' * svgMuscleCatalog.ts —— SVG 肌肉路径目录（自动生成）')
lines.append(' * 来源：muscle_analysis/muscle_layer_front.svg + muscle_layer_back.svg')
lines.append(' * 共 {} 条路径，14 个健身群，中英双语。'.format(len(entries)))
lines.append(' */')
lines.append('')
lines.append("export interface SvgMuscleEntry {")
lines.append("  id: string;")
lines.append("  side: 'front' | 'back';")
lines.append("  fitnessGroup: string;")
lines.append("  zh: string;")
lines.append("  en: string;")
lines.append("}")
lines.append('')
lines.append("export const SVG_CATALOG_VERSION = 'flutter-body-atlas@main-2026-07-12';")
lines.append('')
lines.append('export const FITNESS_GROUPS: { key: string; zh: string; en: string }[] = [')
for g_key in ['chest', 'back', 'traps', 'shoulders', 'biceps', 'triceps', 'forearms', 'abs', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves', 'neck']:
    en = GROUP_KEY_TO_EN[g_key]
    zh = [k for k, v in GROUP_ZH_TO_KEY.items() if v == g_key][0]
    lines.append("  {{ key: '{}', zh: '{}', en: '{}' }},".format(g_key, zh, en))
lines.append('];')
lines.append('')
lines.append('export const SVG_MUSCLE_CATALOG: SvgMuscleEntry[] = [')
for e in entries:
    lines.append("  {{ id: '{}', side: '{}', fitnessGroup: '{}', zh: '{}', en: '{}' }},".format(
        e['id'], e['side'], e['fitnessGroup'], e['zh'], e['en']))
lines.append('];')
lines.append('')
lines.append("// 渲染时隐藏的 SVG 组/区域 id（头部与面部轮廓，非肌肉）")
lines.append("export const HIDDEN_SVG_GROUP_IDS = ['head', 'face'];")
lines.append('')

out = os.path.join(ROOT, '..', 'src', 'data', 'svgMuscleCatalog.ts')
with open(out, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print('Wrote', len(entries), 'entries to', out)
