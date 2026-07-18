/*
 * svgMuscleCatalog.ts —— SVG 肌肉路径目录（自动生成）
 * 来源：muscle_analysis/muscle_layer_front.svg + muscle_layer_back.svg
 * 共 143 条路径，14 个健身群，中英双语。
 */

export interface SvgMuscleEntry {
  id: string;
  side: 'front' | 'back';
  fitnessGroup: string;
  zh: string;
  en: string;
}

export const SVG_CATALOG_VERSION = 'flutter-body-atlas@main-2026-07-12';

export const FITNESS_GROUPS: { key: string; zh: string; en: string }[] = [
  { key: 'chest', zh: '胸部', en: 'Chest' },
  { key: 'back', zh: '背部', en: 'Back' },
  { key: 'traps', zh: '斜方肌', en: 'Traps' },
  { key: 'shoulders', zh: '肩部（三角肌）', en: 'Shoulders (Delts)' },
  { key: 'biceps', zh: '肱二头肌', en: 'Biceps' },
  { key: 'triceps', zh: '肱三头肌', en: 'Triceps' },
  { key: 'forearms', zh: '前臂', en: 'Forearms' },
  { key: 'abs', zh: '腹肌/核心', en: 'Abs / Core' },
  { key: 'glutes', zh: '臀部', en: 'Glutes' },
  { key: 'quads', zh: '股四头肌', en: 'Quads' },
  { key: 'hamstrings', zh: '腘绳肌', en: 'Hamstrings' },
  { key: 'adductors', zh: '内收肌', en: 'Adductors' },
  { key: 'calves', zh: '小腿', en: 'Calves' },
  { key: 'neck', zh: '颈部', en: 'Neck' },
];

export const SVG_MUSCLE_CATALOG: SvgMuscleEntry[] = [
  { id: 'external_oblique_1_l', side: 'back', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_1_r', side: 'back', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'adductor_magnus_l', side: 'back', fitnessGroup: 'adductors', zh: '大收肌', en: 'Adductor Magnus' },
  { id: 'adductor_magnus_r', side: 'back', fitnessGroup: 'adductors', zh: '大收肌', en: 'Adductor Magnus' },
  { id: 'infraspinatus_l', side: 'back', fitnessGroup: 'back', zh: '冈下肌', en: 'Infraspinatus' },
  { id: 'infraspinatus_r', side: 'back', fitnessGroup: 'back', zh: '冈下肌', en: 'Infraspinatus' },
  { id: 'latissimus_dorsi_l', side: 'back', fitnessGroup: 'back', zh: '背阔肌', en: 'Latissimus Dorsi' },
  { id: 'latissimus_dorsi_r', side: 'back', fitnessGroup: 'back', zh: '背阔肌', en: 'Latissimus Dorsi' },
  { id: 'gastrocnemius_l', side: 'back', fitnessGroup: 'calves', zh: '腓肠肌', en: 'Gastrocnemius' },
  { id: 'gastrocnemius_r', side: 'back', fitnessGroup: 'calves', zh: '腓肠肌', en: 'Gastrocnemius' },
  { id: 'anconeus_l', side: 'back', fitnessGroup: 'forearms', zh: '肘肌', en: 'Anconeus' },
  { id: 'anconeus_r', side: 'back', fitnessGroup: 'forearms', zh: '肘肌', en: 'Anconeus' },
  { id: 'brachioradialis_l', side: 'back', fitnessGroup: 'forearms', zh: '肱桡肌', en: 'Brachioradialis' },
  { id: 'brachioradialis_r', side: 'back', fitnessGroup: 'forearms', zh: '肱桡肌', en: 'Brachioradialis' },
  { id: 'extensor_carpi_ulnaris_l', side: 'back', fitnessGroup: 'forearms', zh: '尺侧腕伸肌', en: 'Extensor Carpi Ulnaris' },
  { id: 'extensor_carpi_ulnaris_r', side: 'back', fitnessGroup: 'forearms', zh: '尺侧腕伸肌', en: 'Extensor Carpi Ulnaris' },
  { id: 'extensor_digitorum_l', side: 'back', fitnessGroup: 'forearms', zh: '指总伸肌', en: 'Extensor Digitorum' },
  { id: 'extensor_digitorum_r', side: 'back', fitnessGroup: 'forearms', zh: '指总伸肌', en: 'Extensor Digitorum' },
  { id: 'flexor_carpi_ulnaris_l', side: 'back', fitnessGroup: 'forearms', zh: '尺侧腕屈肌', en: 'Flexor Carpi Ulnaris' },
  { id: 'flexor_carpi_ulnaris_r', side: 'back', fitnessGroup: 'forearms', zh: '尺侧腕屈肌', en: 'Flexor Carpi Ulnaris' },
  { id: 'gluteus_maximus_l', side: 'back', fitnessGroup: 'glutes', zh: '臀大肌', en: 'Gluteus Maximus' },
  { id: 'gluteus_maximus_r', side: 'back', fitnessGroup: 'glutes', zh: '臀大肌', en: 'Gluteus Maximus' },
  { id: 'gluteus_medius_1_l', side: 'back', fitnessGroup: 'glutes', zh: '臀中肌', en: 'Gluteus Medius' },
  { id: 'gluteus_medius_1_r', side: 'back', fitnessGroup: 'glutes', zh: '臀中肌', en: 'Gluteus Medius' },
  { id: 'gluteus_medius_2_l', side: 'back', fitnessGroup: 'glutes', zh: '臀中肌', en: 'Gluteus Medius' },
  { id: 'gluteus_medius_2_r', side: 'back', fitnessGroup: 'glutes', zh: '臀中肌', en: 'Gluteus Medius' },
  { id: 'biceps_femoris_l', side: 'back', fitnessGroup: 'hamstrings', zh: '股二头肌', en: 'Biceps Femoris' },
  { id: 'biceps_femoris_r', side: 'back', fitnessGroup: 'hamstrings', zh: '股二头肌', en: 'Biceps Femoris' },
  { id: 'semimembranosus_1_l', side: 'back', fitnessGroup: 'hamstrings', zh: '半膜肌', en: 'Semimembranosus' },
  { id: 'semimembranosus_1_r', side: 'back', fitnessGroup: 'hamstrings', zh: '半膜肌', en: 'Semimembranosus' },
  { id: 'semimembranosus_2_l', side: 'back', fitnessGroup: 'hamstrings', zh: '半膜肌', en: 'Semimembranosus' },
  { id: 'semimembranosus_2_r', side: 'back', fitnessGroup: 'hamstrings', zh: '半膜肌', en: 'Semimembranosus' },
  { id: 'semitendinosus_l', side: 'back', fitnessGroup: 'hamstrings', zh: '半腱肌', en: 'Semitendinosus' },
  { id: 'semitendinosus_r', side: 'back', fitnessGroup: 'hamstrings', zh: '半腱肌', en: 'Semitendinosus' },
  { id: 'sternocleidomastoid_l', side: 'back', fitnessGroup: 'neck', zh: '胸锁乳突肌', en: 'Sternocleidomastoid' },
  { id: 'sternocleidomastoid_r', side: 'back', fitnessGroup: 'neck', zh: '胸锁乳突肌', en: 'Sternocleidomastoid' },
  { id: 'iliotibial_tract_l', side: 'back', fitnessGroup: 'quads', zh: '髂胫束（筋膜）', en: 'Iliotibial Tract' },
  { id: 'iliotibial_tract_r', side: 'back', fitnessGroup: 'quads', zh: '髂胫束（筋膜）', en: 'Iliotibial Tract' },
  { id: 'lateral_deltoid_l', side: 'back', fitnessGroup: 'shoulders', zh: '三角肌（中束）', en: 'Deltoid (Lateral)' },
  { id: 'lateral_deltoid_r', side: 'back', fitnessGroup: 'shoulders', zh: '三角肌（中束）', en: 'Deltoid (Lateral)' },
  { id: 'posterior_deltoid_l', side: 'back', fitnessGroup: 'shoulders', zh: '三角肌（后束）', en: 'Deltoid (Posterior)' },
  { id: 'posterior_deltoid_r', side: 'back', fitnessGroup: 'shoulders', zh: '三角肌（后束）', en: 'Deltoid (Posterior)' },
  { id: 'trapezius_lower_l', side: 'back', fitnessGroup: 'traps', zh: '斜方肌（下束）', en: 'Trapezius (Lower)' },
  { id: 'trapezius_lower_r', side: 'back', fitnessGroup: 'traps', zh: '斜方肌（下束）', en: 'Trapezius (Lower)' },
  { id: 'trapezius_middle_l', side: 'back', fitnessGroup: 'traps', zh: '斜方肌（中束）', en: 'Trapezius (Middle)' },
  { id: 'trapezius_middle_r', side: 'back', fitnessGroup: 'traps', zh: '斜方肌（中束）', en: 'Trapezius (Middle)' },
  { id: 'trapezius_upper_l', side: 'back', fitnessGroup: 'traps', zh: '斜方肌（上束）', en: 'Trapezius (Upper)' },
  { id: 'trapezius_upper_r', side: 'back', fitnessGroup: 'traps', zh: '斜方肌（上束）', en: 'Trapezius (Upper)' },
  { id: 'triceps_brachii_caput_laterale_l', side: 'back', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
  { id: 'triceps_brachii_caput_laterale_r', side: 'back', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
  { id: 'triceps_brachii_caput_longum_l', side: 'back', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
  { id: 'triceps_brachii_caput_longum_r', side: 'back', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
  { id: 'triceps_brachii_caput_mediale_l', side: 'back', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
  { id: 'triceps_brachii_caput_mediale_r', side: 'back', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
  { id: 'external_oblique_1_l', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_1_r', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_2_l', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_2_r', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_3_l', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_3_r', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_4_l', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_4_r', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_5_l', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_5_r', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_6_l', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_6_r', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_7_l', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_7_r', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_8_l', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'external_oblique_8_r', side: 'front', fitnessGroup: 'abs', zh: '腹外斜肌', en: 'External Oblique' },
  { id: 'rectus_abdominis_1', side: 'front', fitnessGroup: 'abs', zh: '腹直肌', en: 'Rectus Abdominis' },
  { id: 'rectus_abdominis_2_l', side: 'front', fitnessGroup: 'abs', zh: '腹直肌', en: 'Rectus Abdominis' },
  { id: 'rectus_abdominis_2_r', side: 'front', fitnessGroup: 'abs', zh: '腹直肌', en: 'Rectus Abdominis' },
  { id: 'rectus_abdominis_3_l', side: 'front', fitnessGroup: 'abs', zh: '腹直肌', en: 'Rectus Abdominis' },
  { id: 'rectus_abdominis_3_r', side: 'front', fitnessGroup: 'abs', zh: '腹直肌', en: 'Rectus Abdominis' },
  { id: 'rectus_abdominis_4_l', side: 'front', fitnessGroup: 'abs', zh: '腹直肌', en: 'Rectus Abdominis' },
  { id: 'rectus_abdominis_4_r', side: 'front', fitnessGroup: 'abs', zh: '腹直肌', en: 'Rectus Abdominis' },
  { id: 'adductor_longus_l', side: 'front', fitnessGroup: 'adductors', zh: '长收肌', en: 'Adductor Longus' },
  { id: 'adductor_longus_r', side: 'front', fitnessGroup: 'adductors', zh: '长收肌', en: 'Adductor Longus' },
  { id: 'gracilis_l', side: 'front', fitnessGroup: 'adductors', zh: '股薄肌', en: 'Gracilis' },
  { id: 'gracilis_r', side: 'front', fitnessGroup: 'adductors', zh: '股薄肌', en: 'Gracilis' },
  { id: 'pectineus_l', side: 'front', fitnessGroup: 'adductors', zh: '耻骨肌', en: 'Pectineus' },
  { id: 'pectineus_r', side: 'front', fitnessGroup: 'adductors', zh: '耻骨肌', en: 'Pectineus' },
  { id: 'latissimus_dorsi_l', side: 'front', fitnessGroup: 'back', zh: '背阔肌', en: 'Latissimus Dorsi' },
  { id: 'latissimus_dorsi_r', side: 'front', fitnessGroup: 'back', zh: '背阔肌', en: 'Latissimus Dorsi' },
  { id: 'biceps_brachii_caput_breve_l', side: 'front', fitnessGroup: 'biceps', zh: '肱二头肌', en: 'Biceps Brachii' },
  { id: 'biceps_brachii_caput_breve_r', side: 'front', fitnessGroup: 'biceps', zh: '肱二头肌', en: 'Biceps Brachii' },
  { id: 'biceps_brachii_caput_longum_l', side: 'front', fitnessGroup: 'biceps', zh: '肱二头肌', en: 'Biceps Brachii' },
  { id: 'biceps_brachii_caput_longum_r', side: 'front', fitnessGroup: 'biceps', zh: '肱二头肌', en: 'Biceps Brachii' },
  { id: 'extensor_digitorum_longus_l', side: 'front', fitnessGroup: 'calves', zh: '趾长伸肌', en: 'Extensor Digitorum Longus' },
  { id: 'extensor_digitorum_longus_r', side: 'front', fitnessGroup: 'calves', zh: '趾长伸肌', en: 'Extensor Digitorum Longus' },
  { id: 'extensor_hallucis_longus_l', side: 'front', fitnessGroup: 'calves', zh: '拇长伸肌', en: 'Extensor Hallucis Longus' },
  { id: 'extensor_hallucis_longus_r', side: 'front', fitnessGroup: 'calves', zh: '拇长伸肌', en: 'Extensor Hallucis Longus' },
  { id: 'fibularis_longus_l', side: 'front', fitnessGroup: 'calves', zh: '腓骨长肌', en: 'Fibularis Longus' },
  { id: 'fibularis_longus_r', side: 'front', fitnessGroup: 'calves', zh: '腓骨长肌', en: 'Fibularis Longus' },
  { id: 'gastrocnemius_l', side: 'front', fitnessGroup: 'calves', zh: '腓肠肌', en: 'Gastrocnemius' },
  { id: 'gastrocnemius_r', side: 'front', fitnessGroup: 'calves', zh: '腓肠肌', en: 'Gastrocnemius' },
  { id: 'tibialis_anterior_l', side: 'front', fitnessGroup: 'calves', zh: '胫骨前肌', en: 'Tibialis Anterior' },
  { id: 'tibialis_anterior_r', side: 'front', fitnessGroup: 'calves', zh: '胫骨前肌', en: 'Tibialis Anterior' },
  { id: 'pectoralis_major_l', side: 'front', fitnessGroup: 'chest', zh: '胸大肌', en: 'Pectoralis Major' },
  { id: 'pectoralis_major_r', side: 'front', fitnessGroup: 'chest', zh: '胸大肌', en: 'Pectoralis Major' },
  { id: 'brachioradialis_l', side: 'front', fitnessGroup: 'forearms', zh: '肱桡肌', en: 'Brachioradialis' },
  { id: 'brachioradialis_r', side: 'front', fitnessGroup: 'forearms', zh: '肱桡肌', en: 'Brachioradialis' },
  { id: 'extensor_carpi_radialis_longus_l', side: 'front', fitnessGroup: 'forearms', zh: '桡侧腕长伸肌', en: 'Extensor Carpi Radialis Longus' },
  { id: 'extensor_carpi_radialis_longus_r', side: 'front', fitnessGroup: 'forearms', zh: '桡侧腕长伸肌', en: 'Extensor Carpi Radialis Longus' },
  { id: 'flexor_carpi_radialis_l', side: 'front', fitnessGroup: 'forearms', zh: '桡侧腕屈肌', en: 'Flexor Carpi Radialis' },
  { id: 'flexor_carpi_radialis_r', side: 'front', fitnessGroup: 'forearms', zh: '桡侧腕屈肌', en: 'Flexor Carpi Radialis' },
  { id: 'flexor_digitorum_superficialis_l', side: 'front', fitnessGroup: 'forearms', zh: '指浅屈肌', en: 'Flexor Digitorum Superficialis' },
  { id: 'flexor_digitorum_superficialis_r', side: 'front', fitnessGroup: 'forearms', zh: '指浅屈肌', en: 'Flexor Digitorum Superficialis' },
  { id: 'palmaris_longus_l', side: 'front', fitnessGroup: 'forearms', zh: '掌长肌', en: 'Palmaris Longus' },
  { id: 'palmaris_longus_r', side: 'front', fitnessGroup: 'forearms', zh: '掌长肌', en: 'Palmaris Longus' },
  { id: 'pronator_quadratus_l', side: 'front', fitnessGroup: 'forearms', zh: '旋前方肌', en: 'Pronator Quadratus' },
  { id: 'pronator_quadratus_r', side: 'front', fitnessGroup: 'forearms', zh: '旋前方肌', en: 'Pronator Quadratus' },
  { id: 'pronator_teres_l', side: 'front', fitnessGroup: 'forearms', zh: '旋前圆肌', en: 'Pronator Teres' },
  { id: 'pronator_teres_r', side: 'front', fitnessGroup: 'forearms', zh: '旋前圆肌', en: 'Pronator Teres' },
  { id: 'gluteus_medius_2_l', side: 'front', fitnessGroup: 'glutes', zh: '臀中肌', en: 'Gluteus Medius' },
  { id: 'gluteus_medius_2_r', side: 'front', fitnessGroup: 'glutes', zh: '臀中肌', en: 'Gluteus Medius' },
  { id: 'semitendinosus_l', side: 'front', fitnessGroup: 'hamstrings', zh: '半腱肌', en: 'Semitendinosus' },
  { id: 'semitendinosus_r', side: 'front', fitnessGroup: 'hamstrings', zh: '半腱肌', en: 'Semitendinosus' },
  { id: 'platysma', side: 'front', fitnessGroup: 'neck', zh: '颈阔肌', en: 'Platysma' },
  { id: 'sternocleidomastoid_l', side: 'front', fitnessGroup: 'neck', zh: '胸锁乳突肌', en: 'Sternocleidomastoid' },
  { id: 'sternocleidomastoid_r', side: 'front', fitnessGroup: 'neck', zh: '胸锁乳突肌', en: 'Sternocleidomastoid' },
  { id: 'sternohyoid', side: 'front', fitnessGroup: 'neck', zh: '胸骨舌骨肌', en: 'Sternohyoid' },
  { id: 'iliotibial_tract_l', side: 'front', fitnessGroup: 'quads', zh: '髂胫束（筋膜）', en: 'Iliotibial Tract' },
  { id: 'iliotibial_tract_r', side: 'front', fitnessGroup: 'quads', zh: '髂胫束（筋膜）', en: 'Iliotibial Tract' },
  { id: 'rectus_femoris_l', side: 'front', fitnessGroup: 'quads', zh: '股直肌', en: 'Rectus Femoris' },
  { id: 'rectus_femoris_r', side: 'front', fitnessGroup: 'quads', zh: '股直肌', en: 'Rectus Femoris' },
  { id: 'sartoris_l', side: 'front', fitnessGroup: 'quads', zh: '缝匠肌', en: 'Sartorius' },
  { id: 'sartoris_r', side: 'front', fitnessGroup: 'quads', zh: '缝匠肌', en: 'Sartorius' },
  { id: 'vastus_lateralis_l', side: 'front', fitnessGroup: 'quads', zh: '股外侧肌', en: 'Vastus Lateralis' },
  { id: 'vastus_lateralis_r', side: 'front', fitnessGroup: 'quads', zh: '股外侧肌', en: 'Vastus Lateralis' },
  { id: 'vastus_medialis_l', side: 'front', fitnessGroup: 'quads', zh: '股内侧肌', en: 'Vastus Medialis' },
  { id: 'vastus_medialis_r', side: 'front', fitnessGroup: 'quads', zh: '股内侧肌', en: 'Vastus Medialis' },
  { id: 'anterior_deltoid_l', side: 'front', fitnessGroup: 'shoulders', zh: '三角肌（前束）', en: 'Deltoid (Anterior)' },
  { id: 'anterior_deltoid_r', side: 'front', fitnessGroup: 'shoulders', zh: '三角肌（前束）', en: 'Deltoid (Anterior)' },
  { id: 'lateral_deltoid_l', side: 'front', fitnessGroup: 'shoulders', zh: '三角肌（中束）', en: 'Deltoid (Lateral)' },
  { id: 'lateral_deltoid_r', side: 'front', fitnessGroup: 'shoulders', zh: '三角肌（中束）', en: 'Deltoid (Lateral)' },
  { id: 'trapezius_upper_l', side: 'front', fitnessGroup: 'traps', zh: '斜方肌（上束）', en: 'Trapezius (Upper)' },
  { id: 'trapezius_upper_r', side: 'front', fitnessGroup: 'traps', zh: '斜方肌（上束）', en: 'Trapezius (Upper)' },
  { id: 'triceps_brachii_caput_laterale_l', side: 'front', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
  { id: 'triceps_brachii_caput_laterale_r', side: 'front', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
  { id: 'triceps_brachii_caput_longum_l', side: 'front', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
  { id: 'triceps_brachii_caput_longum_r', side: 'front', fitnessGroup: 'triceps', zh: '肱三头肌', en: 'Triceps Brachii' },
];

// 渲染时隐藏的 SVG 组/区域 id（头部与面部轮廓，非肌肉）
export const HIDDEN_SVG_GROUP_IDS = ['head', 'face'];

// 生成 SVG 肌肉路径在 UI 中的显示标签。
// 同一块肌肉在 SVG 里可能被拆成多条 path（如 external_oblique_1_l..8_l），
// 目录里只保存统一基础名；显示时从 id 提取段号，避免列表中出现大量重名。
// 例如：external_oblique_1_l -> "腹外斜肌 1（左）"
//       rectus_abdominis_2_r -> "腹直肌 2（右）"
//       pectoralis_major_l   -> "胸大肌（左）"
export function formatSvgMuscleLabel(entry: SvgMuscleEntry, locale: string): string {
  let base = locale === 'zh' ? entry.zh : entry.en;
  const segmentMatch = entry.id.match(/_(\d+)(?:_l|_r)?$/);
  if (segmentMatch) {
    const segment = segmentMatch[1];
    base += locale === 'zh' ? ` ${segment}` : ` ${segment}`;
  }
  if (entry.id.endsWith('_l')) {
    base += locale === 'zh' ? '（左）' : ' (L)';
  } else if (entry.id.endsWith('_r')) {
    base += locale === 'zh' ? '（右）' : ' (R)';
  }
  return base;
}
