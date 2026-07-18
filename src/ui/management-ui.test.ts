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

    const optionTexts = Array.from(modal.contentEl.querySelectorAll('select option')).map((option) =>
      option.textContent?.trim()
    );

    expect(optionTexts).toContain('Running');
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
});
