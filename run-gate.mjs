/**
 * run-gate.mjs —— 执行类工具的统一"能不能跑"判定（纯函数，无副作用，可单测）
 *
 * 为什么单独成模块：判定逻辑一旦混在工具 handler 里就没法在不启动 BetterGI 的前提下验证；
 * 而"该不该拦"恰恰是最需要测试的部分（拦错了会让用户以为工具坏了，不拦会让用户白跑一场）。
 *
 * 口径（来自实测与源码）：
 *   · 硬阻断：BetterGI 已在运行（命令行会被转发）、客户区 0x0、非 16:9、< 1920×1080（识别素材只有 1080p 一套）、
 *             窗口最小化（截图必失败）、屏幕已锁定（SendInput/截图被系统整体吞掉且不报错）、
 *             Session 0（服务/SSH 会话没有桌面输入权限，实测 SendInput err=1459/err=5）
 *   · 软警告：不在前台（自动化会暂停在第一帧，但调用方可以先 focus 再跑）、
 *             锁屏/会话状态未知（旧版 bettergi-control 的 bgi-status.ps1 不输出 session 字段，
 *             或 WTSInfoEx 探测失败——不能硬拦，否则误杀还没升级技能仓的用户）
 *   · force=true 时不拦，但把"已强制放行"如实标注出来
 *
 * session 字段口径（bgi-status.ps1 采集，2026-11-17 ZMAL-PC 实测）：
 *   { sessionId, state, stateName, flags, locked, known }
 *   locked 来自 WTSInfoEx.SessionFlags（0=LOCK / 1=UNLOCK，注意 0 才是锁）；
 *   known=false 或字段缺失 ⇒ 判不了，只给软警告。
 */
export function evaluateRunGate(status, { force = false, requireGame = true } = {}) {
  const blockers = [];
  const warnings = [];
  const st = status || {};

  // 会话/锁屏：比窗口更底层的阻断——屏幕锁着或人在 Session 0，后面所有检查都没意义，
  // 但照旧全部跑完，让用户一次看到所有问题而不是修一个冒一个。
  const sess = st.session;
  const sessKnown = !!sess && sess.known !== false && typeof sess.locked === 'boolean';
  if (!sessKnown) {
    warnings.push('无法判定锁屏/会话状态（bettergi-control 过旧未输出 session 字段，或 WTSInfoEx 探测失败）→ 不能保证屏幕已解锁、进程在交互会话；无人值守跑之前请人工确认');
  } else {
    if (sess.locked) {
      blockers.push('屏幕已锁定（SessionFlags=0=LOCK）：SendInput/截图会被系统整体吞掉且不报错 → 任务会静默白跑，先解锁屏幕');
    }
    if (Number(sess.sessionId) === 0) {
      blockers.push('当前是 Session 0（服务/SSH 会话）：没有桌面输入权限（实测 SendInput err=1459/err=5）→ 需经计划任务 /IT 或自动登录进交互会话再跑');
    }
  }

  if (st.bgiRunning) {
    blockers.push('BetterGI 已在运行：命令行触发只会被转发、不会真正执行（先退出它，或用包装器 _daily_runner.ps1 清场）');
  }

  if (requireGame) {
    const gw = st.gameWindow;
    if (!gw) {
      blockers.push('读不到游戏窗口信息（游戏没在运行？）');
    } else {
      const w = Number(gw.clientWidth) || 0;
      const h = Number(gw.clientHeight) || 0;
      if (w === 0 || h === 0) {
        blockers.push('游戏窗口客户区 0x0（游戏可能还在启动，或被最小化到没有客户区）');
      } else {
        if (!gw.is169) blockers.push(`客户区 ${w}x${h} 不是 16:9 → 识别与坐标换算都会错`);
        if (!gw.atLeast1080p) blockers.push(`客户区 ${w}x${h} 小于 1920x1080 → 内置识别素材只有 1080p 一套，会大面积漏识别`);
      }
      if (gw.minimized) blockers.push('游戏窗口处于最小化 → 截图会失败');
      if (!gw.foreground) {
        warnings.push(`游戏不在前台（当前前台窗口：${gw.foregroundTitle || '未知'}）→ 自动化通常会在第一帧暂停；先让它到前台再跑`);
      }
    }
  }

  const gate = {
    canRun: !!force || blockers.length === 0,
    blockers,
    warnings,
    forced: !!force && blockers.length > 0,
    requiresGame: !!requireGame,
  };
  gate.lines = renderGate(gate);
  return gate;
}

/** 生成给用户/agent 看的多行说明（空数组时给一句"可跑"） */
export function renderGate(gate) {
  const lines = [];
  if (gate.blockers.length) {
    lines.push('⛔ 现在跑会白跑（实质阻断）：');
    for (const b of gate.blockers) lines.push(`  - ${b}`);
  }
  if (gate.warnings.length) {
    lines.push('⚠ 注意：');
    for (const w of gate.warnings) lines.push(`  - ${w}`);
  }
  if (!gate.blockers.length && !gate.warnings.length) lines.push('✓ 前置检查通过（屏幕未锁、会话可交互、窗口可用、BetterGI 未占用）');
  if (gate.forced) lines.push('（你带了 force:true → 已强制放行，风险自负）');
  return lines;
}

/** 从 statusBrief() 的返回里取出判定所需字段（容错：字段缺失按"未知"处理，不误判为可跑） */
export function statusForGate(st) {
  if (!st) return { bgiRunning: true, session: null, gameWindow: null };
  const gw = st.gameWindow || null;
  const sess = st.session || null;
  return {
    bgiRunning: !!st.bgiRunning,
    // 原样透传采集侧的判定结果；缺失（旧版 bgi-status.ps1）保持 null，由闸门降级成软警告
    session: sess
      ? {
        sessionId: sess.sessionId,
        state: sess.state,
        stateName: sess.stateName,
        flags: sess.flags,
        locked: typeof sess.locked === 'boolean' ? sess.locked : null,
        known: sess.known !== false && typeof sess.locked === 'boolean',
      }
      : null,
    gameWindow: gw
      ? {
        clientWidth: gw.clientWidth,
        clientHeight: gw.clientHeight,
        is169: !!gw.is169,
        atLeast1080p: !!gw.atLeast1080p,
        minimized: !!gw.minimized,
        foreground: !!gw.foreground,
        foregroundTitle: gw.foregroundTitle,
      }
      : null,
  };
}
