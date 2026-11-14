// @vitest-environment jsdom

/*
 * management-ui.test.ts（Vitest 回归测试）
 * 文件作用：用 vitest 验证各个弹窗/设置页渲染是否正确（如英文环境下训练项显示 Running、删除行不串数据等）。
 * 架构角色：这是一组"回归测试"——一旦有人改坏界面渲染，测试就会失败、及时报警。
 * 关键概念：
 *   - vitest：一个测试框架（类似 Jest），`it(...)` 定义一个用例，`expect(...)` 做断言，`describe` 把用例分组。
 *   - jsdom：在 Node 里模拟浏览器 DOM（document/元素等），让我们能在没有真浏览器时操作页面元素。
 *   - installDomHelpers：真实 Obsidian 给元素加了一些便捷方法（empty/addClass/setText/createEl…），jsdom 没有，
 *     这里手动把这些方法补到元素的原型上，测试代码才能正常调用。
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetNotices } from '../test/obsidian-shim';

// 给 jsdom 的 HTML 元素补充 Obsidian 风格的便捷方法（empty/addClass/setText/createEl 等）
function installDomHelpers() {
  const elementProto = HTMLElement.prototype as HTMLElement & {
    empty?: () => void;
    addClass?: (...classes: string[]) => void;
    setText?: (text: string) => void;
    createEl?: (tag: string, options?: Record<string, unknown>) => HTMLElement;
    createDiv?: (options?: Record<string, unknown>) => HTMLDivElement;
    createButton?: (options?: Record<string, unknown>) => HTMLButtonElement;
  };

  if (!elementProto.empty) {
    // empty：清空元素内部所有子内容（等价 innerHTML = ''）
    elementProto.empty = function empty() {
      this.innerHTML = '';
    };
  }

  if (!elementProto.addClass) {
    // addClass：批量添加 CSS 类
    elementProto.addClass = function addClass(...classes: string[]) {
      this.classList.add(...classes);
    };
  }

  if (!elementProto.setText) {
    // setText：设置元素显示的纯文本
    elementProto.setText = function setText(text: string) {
      this.textContent = text;
    };
  }

  // applyOptions：把 Obsidian 的"创建元素配置项"(text/cls/type/placeholder/value) 应用到新元素上
  const applyOptions = (el: HTMLElement, options?: Record<string, unknown>) => {
    if (!options) return el;

    if (typeof options.text === 'string') {
      el.textContent = options.text;
    }
    if (typeof options.cls === 'string') {
      el.className = options.cls;
    }
    if (typeof options.type === 'string' && 'type' in el) {
      (el as HTMLInputElement).type = options.type;
    }
    if (typeof options.placeholder === 'string' && 'placeholder' in el) {
      (el as HTMLInputElement | HTMLTextAreaElement).placeholder = options.placeholder;
    }
    if (typeof options.value === 'string' && 'value' in el) {
      (el as HTMLInputElement | HTMLSelectElement).value = options.value;
    }

    return el;
  };

  if (!elementProto.createEl) {
    // createEl：创建一个指定标签的元素，套用配置，并挂到当前元素下
    elementProto.createEl = function createEl(this: HTMLElement, tag: string, options?: Record<string, unknown>) {
      const el = document.createElement(tag);
      applyOptions(el, options);
      this.appendChild(el);
      return el;
    } as any;
  }

  if (!elementProto.createDiv) {
    // createDiv：快捷创建 <div>
    elementProto.createDiv = function createDiv(options?: Record<string, unknown>) {
      return this.createEl?.('div', options) as HTMLDivElement;
    };
  }

  if (!elementProto.createButton) {
    // createButton：快捷创建 <button>
    elementProto.createButton = function createButton(options?: Record<string, unknown>) {
      return this.createEl?.('button', options) as HTMLButtonElement;
    };
  }
}

// 等待所有 microtask / 宏任务刷新（用于异步渲染链）。
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// beforeAll：本组所有用例开始前只执行一次（这里用于安装 DOM 辅助方法）
beforeAll(() => {
  installDomHelpers();
});

// beforeEach：每个用例前都执行：清空页面、清空通知、清空 mock，保证用例互不干扰
beforeEach(() => {
  document.body.innerHTML = '';
  __resetNotices();
  vi.clearAllMocks();
});

describe('management UI regressions', async () => {
  // 动态导入被测模块（用 await import 以便在 describe 内按需加载）
  const { DEFAULT_SETTINGS } = await import('../data/types');
  const { getDefaultConfig } = await import('../data/seed');
  const { setLocale, getLocale } = await import('../i18n');
  const { RecordModal } = await import('./RecordModal');
  const { ExerciseManagerModal } = await import('./ExerciseManagerModal');
  const { MuscleManagerModal } = await import('./MuscleManagerModal');
  const { SettingsTab } = await import('./SettingsTab');
  const { TypeModal } = await import('./TypeModal');
  const { TypeManagerModal } = await import('./TypeManagerModal');
  const { resolveLogExerciseName } = await import('../data/display');
  const { MuscleEditModal } = await import('./MuscleEditModal');

  // 构造一个假的 App 对象：只提供测试需要的 vault.getFolders / loadData / saveData
  function createApp() {
    return {
      vault: {
        getFolders: () => [{ path: 'logs' }, { path: 'config' }],
      },
      loadData: vi.fn(async () => null),
      saveData: vi.fn(async () => undefined),
    };
  }

  // 构造一个假的 DataManager（数据管理接口）：用真实默认配置，所有方法都用 vi.fn 模拟（记录是否被调用、传了什么参数）
  function createDataManager() {
    const settings = { ...DEFAULT_SETTINGS };
    const config = structuredClone(getDefaultConfig());
    return {
      app: createApp(),
      getConfig: vi.fn(async () => config),
      getConfigSync: vi.fn(() => config),
      getSettings: vi.fn(() => settings),
      saveSettings: vi.fn(async () => undefined),
      addExercise: vi.fn(async () => undefined),
      updateExercise: vi.fn(async () => undefined),
      deleteExercise: vi.fn(async () => undefined),
      addPlanLogs: vi.fn(async () => undefined),
      addMuscle: vi.fn(async () => undefined),
      updateMuscle: vi.fn(async () => undefined),
      deleteMuscle: vi.fn(async () => undefined),
      addTrainingType: vi.fn(async () => undefined),
      updateTrainingType: vi.fn(async () => undefined),
      deleteTrainingType: vi.fn(async () => undefined),
      getLastValues: vi.fn(() => null),
    };
  }

  // 用例：切换到英文后，记录弹窗里的默认训练项名应显示为英文 Running
  it('localizes default exercise names in the record modal when locale switches to English', async () => {
    setLocale('en');
    const dataManager = createDataManager();
    const modal = new RecordModal(dataManager as any);

    await modal.onOpen();

    // 训练项用 combobox（input + 下拉 div），不是 <select>；候选训练项名渲染在各
    // .workout-combo-item 的首个 span 中（第二个 span 才是类型标签）。
    const exerciseNameTexts = Array.from(
      modal.contentEl.querySelectorAll('.workout-combo-item > span:first-child')
    ).map((span) => span.textContent?.trim());

    expect(exerciseNameTexts).toContain('Running');
  });

  // 用例：训练项管理列表应直接渲染出完整明细（类型/主练肌群/次练肌群）以及 Edit/Delete 按钮
  it('renders full exercise details directly in the exercise manager list', async () => {
    setLocale('en');
    const dataManager = createDataManager();
    const modal = new ExerciseManagerModal(dataManager as any);

    await modal.onOpen();

    const text = modal.contentEl.textContent ?? '';
    const runningRow = Array.from(modal.contentEl.querySelectorAll('.workout-card')).find((row) =>
      row.textContent?.includes('Running')
    ) as HTMLElement;
    const detailLines = Array.from(runningRow.querySelectorAll('.workout-card-meta')).map((el) =>
      el.textContent?.trim()
    );
    const actionButtons = Array.from(runningRow.querySelectorAll('.workout-action-btn, .workout-danger-btn')).map((button) =>
      button.textContent?.trim()
    );

    expect(text).toContain('Running');
    expect(text).toContain('Primary: Quads');
    expect(text).toContain('Secondary: Hamstrings, Front Calves');
    expect(detailLines).toEqual([
      'Type: Aerobic',
      'Primary: Quads',
      'Secondary: Hamstrings, Front Calves',
    ]);
    expect(actionButtons).toEqual(['Edit', 'Delete']);
  });

  // 用例：肌肉管理列表应渲染出带标签的明细（名称/部位/是否计入覆盖/建议间隔/已映射路径）以及按钮
  it('renders labeled side, coverage, and frequency details in the muscle manager list', async () => {
    setLocale('en');
    const dataManager = createDataManager();
    // 列表渲染分支依赖 muscleMappingInitialized：真实首次打开时它由引导流程置 true。
    // 测试直接置 true，使 onOpen 走 renderMuscles（而非引导卡）。
    dataManager.getSettings().muscleMappingInitialized = true;
    const modal = new MuscleManagerModal(dataManager as any);

    await modal.onOpen();

    const text = modal.contentEl.textContent ?? '';

    const config = await dataManager.getConfig();
    const chest = config.muscles.find((m) => m.id === 'chest')!;
    const mappedCount = chest.svgRegionIds?.length ?? 0;

    expect(text).toContain('Name: chest');
    expect(text).toContain('Count toward coverage: On');
    expect(text).toContain('Rest threshold (days): 7 days');
    const firstRow = modal.contentEl.querySelector('.workout-card') as HTMLElement;
    const detailLines = Array.from(firstRow.querySelectorAll('.workout-card-meta')).map((el) =>
      el.textContent?.trim()
    );
    const actionButtons = Array.from(firstRow.querySelectorAll('.workout-action-btn, .workout-danger-btn')).map((button) =>
      button.textContent?.trim()
    );
    expect(detailLines).toEqual([
      'Name: chest',
      'Count toward coverage: On',
      'Rest threshold (days): 7 days',
      `Mapped paths: ${mappedCount}`,
    ]);
    expect(actionButtons).toEqual(['Edit', 'Delete']);
  });

  // 用例：声明式设置定义应为两个"数据目录"各提供一个 folder 控件（等价原 Browse 浏览按钮）
  it('provides folder controls for both data directory settings', async () => {
    setLocale('en');
    const dataManager = createDataManager();
    const tab = new SettingsTab(dataManager.app as any, {} as any, dataManager as any);

    const defs = tab.getSettingDefinitions() as any[];
    const dataPathGroup = defs.find((d) => d.type === 'group' && d.heading === 'Data File Locations');
    expect(dataPathGroup).toBeDefined();
    const folderKeys = (dataPathGroup!.items as any[])
      .map((item) => item.control?.key)
      .filter((key: string) => key === 'csvDirectory' || key === 'configDirectory');
    expect(folderKeys.sort()).toEqual(['configDirectory', 'csvDirectory']);
  });

  // 用例：训练类型管理列表应把明细拆成单独行，并带 Edit/Delete 按钮
  it('renders training type rows with separate detail lines and action buttons', async () => {
    setLocale('en');
    const dataManager = createDataManager();
    const modal = new TypeManagerModal(dataManager as any);

    await modal.onOpen();

    const strengthRow = Array.from(modal.contentEl.querySelectorAll('.workout-card')).find((row) =>
      row.textContent?.includes('Strength')
    ) as HTMLElement;
    const detailLines = Array.from(strengthRow.querySelectorAll('.workout-card-meta')).map((el) =>
      el.textContent?.trim()
    );
    const actionButtons = Array.from(strengthRow.querySelectorAll('.workout-action-btn, .workout-danger-btn')).map((button) =>
      button.textContent?.trim()
    );

    expect(detailLines).toEqual(['Fields: Weight, Reps', 'Contributes to Coverage: On']);
    expect(actionButtons).toEqual(['Edit', 'Delete']);
  });

  // 用例：声明式语言下拉变更（setControlValue）应即时切换语言
  it('switches locale when language is changed via setControlValue', async () => {
    setLocale('zh');
    const dataManager = createDataManager();
    const tab = new SettingsTab(dataManager.app as any, {} as any, dataManager as any);

    // 声明式定义应包含 language 下拉（zh/en 两个选项）
    const defs = tab.getSettingDefinitions() as any[];
    const languageControl = defs
      .flatMap((d) => (d.items ? d.items : []))
      .map((item: any) => item.control)
      .find((c: any) => c && c.key === 'language');
    expect(languageControl).toBeDefined();
    expect(Object.keys(languageControl.options).sort()).toEqual(['en', 'zh']);

    // 模拟 Obsidian 在声明式下拉变更时调用 setControlValue，应即时切换语言
    await tab.setControlValue('language', 'en');
    expect(getLocale()).toBe('en');
  });

  // 用例 M1：保存一个"字段只用 labelKey、没有纯文本 label"的内置训练类型（旧逻辑会误拦保存，这里验证能通过）
  it('M1: saves a built-in training type whose fields use labelKey only (no plain label)', async () => {
    setLocale('en');
    const dataManager = createDataManager();
    const config = await dataManager.getConfig();
    const strength = config.trainingTypes.find((t) => t.id === 'strength')!;
    // strength 的字段只有 labelKey（field.weight），没有 label —— 旧逻辑会因 validFields 为空而拦截保存
    const modal = new TypeModal(dataManager as any, { editType: strength });

    modal.onOpen();

    const nameInput = modal.contentEl.querySelector('input') as HTMLInputElement;
    nameInput.value = 'Strength';

    const saveBtn = Array.from(modal.contentEl.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Save'
    )!;
    saveBtn.click();

    await flush();

    expect(dataManager.updateTrainingType).toHaveBeenCalled();
  });

  // 用例 H2（原 PlanRecordModal 多行动态增删测试）已随「新增训练计划」Modal 重构移除：
  // 旧「记录训练方案」弹窗（一次性写多条记录）已被「新增训练计划」（写 workout-config.json 的 plans）取代，
  // 交互模型完全不同，相关回归用例不再适用。

  // 用例 F1：resolveLogExerciseName 优先用 exerciseId 解析名称，旧数据无 id 时回退到存储名
  it('F1: resolveLogExerciseName prefers exerciseId and falls back to stored name', async () => {
    setLocale('en');
    const config = getDefaultConfig();

    // 新数据：用 exerciseId 解析，即使存储名过期也显示配置中的最新名
    expect(resolveLogExerciseName(config, { exerciseId: 'squat' } as any)).toBe('Squat');
    // 无 exerciseId（旧数据）：已无法关联配置，返回空串
    expect(resolveLogExerciseName(config, { } as any)).toBe('');
    // 未知 id：返回空串
    expect(resolveLogExerciseName(config, { exerciseId: 'nope' } as any)).toBe('');
  });

  // 用例 F1（原 PlanRecordModal 保存写多条记录）已随 Modal 重构移除，理由同上。

  // 用例：编辑肌肉页的「恢复设置」折叠区——默认收起、四个数值参数、留空跟随默认、填了才落库
  it('renders the recovery tuning section collapsed, and saves overrides only when filled', async () => {
    setLocale('zh');
    const dataManager = createDataManager();
    const config = await dataManager.getConfig();
    const muscle = config.muscles[0];
    const modal = new MuscleEditModal(dataManager as any, { muscle } as any);

    await modal.onOpen();

    // 三个折叠区按次序：SVG 肌肉映射 / 热力图设置 / 恢复曲线设置
    const sections = Array.from(
      modal.contentEl.querySelectorAll<HTMLDetailsElement>('details.workout-advanced')
    );
    expect(sections.map((d) => d.querySelector('summary')!.children[0].textContent!.trim())).toEqual([
      'SVG 肌肉映射',
      '热力图设置',
      '恢复曲线设置',
    ]);
    // 三个折叠区**全部默认收起**（用户口径：设置项不常看，别占视线）
    expect(sections.map((d) => d.open)).toEqual([false, false, false]);
    const details = sections[2] as HTMLDetailsElement;

    const inputs = Array.from(details!.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    // 七个数值参数：急性四个（疲劳/适应各两项）＋ 长期三个（消退深度/记忆/维持量）
    expect(inputs.length).toBe(7);
    // 第 5 项在界面上是「运动前水平」= 100 − 消退深度，所以占位显示 92 而不是 8
    expect(inputs.map((i) => i.placeholder)).toEqual(['2.8', '2.5', '1', '10', '92', '60', '8']);
    expect(inputs.every((i) => i.value === '')).toBe(true); // 未设置 → 全部留空

    // 只填一个：保存时只落这一个字段，其余仍不写（跟随默认）
    inputs[1].value = '4';
    inputs[1].dispatchEvent(new Event('input'));
    await (modal as any).save();

    const payload = (dataManager.updateMuscle as any).mock.calls[0][1];
    expect(payload.recovery).toEqual({ fatigueTau: 4 });
  });

  // 用例：已有逐肌参数时，折叠区标题显示「已自定义」并把值回填到输入框
  it('prefills recovery overrides and marks the section as customized', async () => {
    setLocale('zh');
    const dataManager = createDataManager();
    const config = await dataManager.getConfig();
    const muscle = { ...config.muscles[0], recovery: { fatiguePerSet: 3.5, fitnessTau: 21 } };
    const modal = new MuscleEditModal(dataManager as any, { muscle } as any);

    await modal.onOpen();

    const details = Array.from(modal.contentEl.querySelectorAll('details.workout-advanced')).find(
      (d) => d.querySelector('summary')!.textContent!.includes('恢复曲线设置')
    ) as HTMLDetailsElement;
    // 标题旁不再挂「跟随默认 / 已自定义」角标（用户要求去掉），标题只有自己
    expect(details.querySelector('summary')!.textContent!.trim()).toBe('恢复曲线设置');
    const inputs = Array.from(details.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    expect(inputs[0].value).toBe('3.5');
    expect(inputs[1].value).toBe('');
    expect(inputs[3].value).toBe('21');
  });

  // 用例：恢复曲线设置底部的预览图——默认就画出来，改参数立刻重画（形状随参数变）
  it('recovery section renders a live preview that redraws when a parameter changes', async () => {
    setLocale('zh');
    const { MuscleEditModal } = await import('./MuscleEditModal');
    const dataManager = createDataManager();
    const config = await dataManager.getConfig();
    const modal = new MuscleEditModal(dataManager as any, { muscle: config.muscles[0] } as any);

    await modal.onOpen();

    const details = Array.from(modal.contentEl.querySelectorAll('details.workout-advanced')).find((d) =>
      d.querySelector('summary')!.textContent!.includes('恢复曲线设置')
    ) as HTMLDetailsElement;
    const preview = details.querySelector('.workout-recovery-preview')!;
    expect(preview).toBeTruthy();
    const path = preview.querySelector('path')!;
    expect(path).toBeTruthy();
    const before = path.getAttribute('d');
    expect(before!.length).toBeGreaterThan(10);

    // 一次标准训练：8 练度，说明行里有「练完 X」与恢复天数
    expect(preview.querySelector('.workout-recovery-preview-caption')!.textContent).toContain('8 练度');
    expect(preview.querySelector('.workout-recovery-preview-caption')!.textContent).toContain('练完');

    // 改疲劳动力度（第 1 个数字框）→ 预览立刻重画，曲线形状不同
    const fatigue = Array.from(details.querySelectorAll('input[type="number"]'))[0] as HTMLInputElement;
    fatigue.value = '6';
    fatigue.dispatchEvent(new Event('input'));

    const after = preview.querySelector('path')!.getAttribute('d');
    expect(after).not.toBe(before);
  });

  // 用例：发展视图的两个时间窗（天）——默认占位 28 / 84，填了才落库，且中位数窗不短于近期窗
  it('growth view windows: default placeholders, persisted only when filled', async () => {
    setLocale('zh');
    const { MuscleEditModal } = await import('./MuscleEditModal');
    const dataManager = createDataManager();
    const config = await dataManager.getConfig();

    const modal = new MuscleEditModal(dataManager as any, { muscle: config.muscles[0] } as any);
    await modal.onOpen();
    const hm = Array.from(modal.contentEl.querySelectorAll('details.workout-advanced')).find((d) =>
      d.querySelector('summary')!.textContent!.includes('热力图设置')
    )!;
    Array.from(hm.querySelectorAll('button')).find((b) => b.textContent.includes('发展视图'))!.click();

    const wins = Array.from(hm.querySelectorAll('input[type="number"]')).slice(0, 2) as HTMLInputElement[];
    expect(wins.map((i) => i.placeholder)).toEqual(['28', '84']);
    expect(wins.every((i) => i.value === '')).toBe(true); // 未设置 → 留空

    wins[0].value = '14';
    wins[0].dispatchEvent(new Event('input'));
    wins[1].value = '56';
    wins[1].dispatchEvent(new Event('input'));

    await (modal as any).save();
    const payload = (dataManager.updateMuscle as any).mock.calls[0][1];
    expect(payload.growthRecentDays).toBe(14);
    expect(payload.growthBaselineDays).toBe(56);
  });

  // 用例：训练项的练度（weight）——勾选后才出现输入框；填了就落库，没填不写字段
  it('saves the per-muscle stimulus (weight) when filled, and omits it when blank', async () => {
    setLocale('zh');
    const { ExerciseModal } = await import('./ExerciseModal');
    const dataManager = createDataManager();
    const config = await dataManager.getConfig();
    const modal = new ExerciseModal(dataManager as any, {});

    await modal.onOpen();

    (modal as any).nameInput.value = 'stimulus-test-exercise';
    (modal as any).categorySelect.value = config.trainingTypes[0].id;

    const items = Array.from(modal.contentEl.querySelectorAll('.workout-check-item'));
    const firstCb = items[0].querySelector('input[type="checkbox"]') as HTMLInputElement;
    const firstWeight = items[0].querySelector('.workout-muscle-weight') as HTMLInputElement;
    const secondCb = items[1].querySelector('input[type="checkbox"]') as HTMLInputElement;

    // 未勾选 → 练度框隐藏（避免一屏几十个空输入框）
    expect(firstWeight.style.display).toBe('none');
    firstCb.checked = true;
    firstCb.dispatchEvent(new Event('change'));
    expect(firstWeight.style.display).not.toBe('none');
    firstWeight.value = '2.5';

    // 第二块肌肉只勾选、不填练度 → 保存时不应写 weight（跟随角色默认）
    secondCb.checked = true;
    secondCb.dispatchEvent(new Event('change'));

    await (modal as any).save();

    const payload = (dataManager.addExercise as any).mock.calls[0][0];
    const saved = payload.muscles as Array<{ muscleId: string; weight?: number }>;
    expect(saved.find((m) => m.muscleId === firstCb.value)!.weight).toBe(2.5);
    expect(saved.find((m) => m.muscleId === secondCb.value)!.weight).toBeUndefined();
  });

  // 用例：发展视图色标——默认跟随内置（不写配置）；改了阈值才落库
  it('growth view scale: follows defaults until edited, then persists', async () => {
    setLocale('zh');
    const { MuscleEditModal } = await import('./MuscleEditModal');
    const dataManager = createDataManager();
    const config = await dataManager.getConfig();

    // 不动它：保存不应写 growthLevels
    const untouched = new MuscleEditModal(dataManager as any, { muscle: config.muscles[0] } as any);
    await untouched.onOpen();
    const hm = Array.from(untouched.contentEl.querySelectorAll('details.workout-advanced')).find((d) =>
      d.querySelector('summary')!.textContent!.includes('热力图设置')
    )!;
    // 默认是恢复视图：有指标下拉与「指标」字样，没有比值说明
    expect(hm.querySelector('select')).toBeTruthy();
    expect(hm.textContent).toContain('指标');
    expect(hm.textContent).not.toContain('比值');

    // 切到发展视图：设置区换成比值色标
    const growthBtn = Array.from(hm.querySelectorAll('button')).find((b) => b.textContent.includes('发展视图'))!;
    growthBtn.click();
    expect(hm.textContent).toContain('比值');
    await (untouched as any).save();
    expect((dataManager.updateMuscle as any).mock.calls[0][1].growthLevels).toBeUndefined();

    // 改一个阈值 → 视为自定义并整组落库
    const edited = new MuscleEditModal(dataManager as any, { muscle: config.muscles[0] } as any);
    await edited.onOpen();
    const hm2 = Array.from(edited.contentEl.querySelectorAll('details.workout-advanced')).find((d) =>
      d.querySelector('summary')!.textContent!.includes('热力图设置')
    )!;
    Array.from(hm2.querySelectorAll('button')).find((b) => b.textContent.includes('发展视图'))!.click();
    const maxInput = hm2.querySelector('input.workout-scale-max') as HTMLInputElement;
    expect(maxInput).toBeTruthy();
    maxInput.value = '0.6';
    maxInput.dispatchEvent(new Event('input', { bubbles: true }));
    await (edited as any).save();

    const saved = (dataManager.updateMuscle as any).mock.calls[1][1].growthLevels as Array<{ max?: number }>;
    expect(Array.isArray(saved)).toBe(true);
    expect(saved[0].max).toBe(0.6);
  });

  // 用例：代码块设置按钮打开的「恢复曲线设置」弹窗——七个参数 + 预览；保存只写填过的项
  it('recovery settings modal: form + preview, saves only the fields that were filled', async () => {
    setLocale('zh');
    const { RecoverySettingsModal } = await import('./RecoverySettingsModal');
    const dataManager = createDataManager();
    const config = await dataManager.getConfig();
    const muscle = config.muscles[0];

    const modal = new RecoverySettingsModal(dataManager as any, { muscle } as any);
    await modal.onOpen();

    const inputs = Array.from(modal.contentEl.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    expect(inputs.length).toBe(7);
    expect(inputs.map((i) => i.placeholder)).toEqual(['2.8', '2.5', '1', '10', '92', '60', '8']);
    expect(modal.contentEl.querySelector('.workout-recovery-preview svg')).toBeTruthy();

    inputs[1].value = '4'; // 疲劳消退（天）
    inputs[1].dispatchEvent(new Event('input'));
    await (modal as any).save();

    const [savedId, payload] = (dataManager.updateMuscle as any).mock.calls[0];
    expect(savedId).toBe(muscle.id);
    expect(payload.recovery).toEqual({ fatigueTau: 4 });
  });

  it('recovery settings modal: leaving everything blank clears the override', async () => {
    setLocale('zh');
    const { RecoverySettingsModal } = await import('./RecoverySettingsModal');
    const dataManager = createDataManager();
    const config = await dataManager.getConfig();
    const muscle = { ...config.muscles[0], recovery: { fatigueTau: 6 } };

    const modal = new RecoverySettingsModal(dataManager as any, { muscle } as any);
    await modal.onOpen();
    const input = Array.from(modal.contentEl.querySelectorAll('input[type="number"]'))[1] as HTMLInputElement;
    expect(input.value).toBe('6'); // 已覆盖的值要回填
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await (modal as any).save();

    const payload = (dataManager.updateMuscle as any).mock.calls[0][1];
    expect(payload.recovery).toBeUndefined(); // 不存「一堆默认值」，回到跟随默认
  });
});
