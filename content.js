(() => {
  'use strict';

  // =========================
  // 設定
  // =========================

  // 実ゲームの丸めにズレを感じたら 'floor' / 'round' / 'ceil' を切り替えてください
  const POWER_ROUND_MODE = 'floor';

  // 候補数が多すぎると重いので、必要に応じて調整
  const CONFIG = {
    topDeckOptionsPerWork: 120, // 各ワークで保持する候補デッキ数
    optimizeYieldEvery: 250,
    storageCacheVersion: 2,
    storageCacheMaxEntries: 300,
    prefilterOverallKeep: 260,
    prefilterPerClubKeep: 32,
    prefilterFocusClubCount: 10,
    prefilterMinPowerExtraKeep: 60,
    candidateOverallKeep: 180,
    candidatePerClubKeep: 24,
    candidateFocusClubCount: 8,
    candidateMinPowerExtraKeep: 36,
    synergyAnchorKeep: 100,
    synergyPairAnchorKeep: 24,
    synergyPoolKeep: 18,
    synergyGeneralKeep: 12,
    currentDeckSwapPoolKeep: 18,
    currentDeckPairSwapKeep: 8,
    synergyProgressEveryDecks: 1000,
    autoStepDelay: 300,
    autoClickDelay: 220,
    autoClickDelayLong: 420,
  };

  const CLUBS = [
    'びしょく・りょうり部',
    'ぱーてぃくるらい部',
    'えいぞうけんきゅう部',
    'まんが・いらすと部',
    'ダンス部',
    'せいとかい',
    'しゃしん部',
    'えんそく部',
    'いんしゅ部',
    'おんがく部',
    'かいはつ部',
    'けいおん部',
    'ゲーム部',
    'こーほー部',
    'さぎょう部',
    'ぞうけい部',
    'デザイン部',
    'ほうそう部',
    'もでりんぐ部',
    '帰宅部',
  ].sort((a, b) => b.length - a.length);

  const WORK_RULES = {
    'たまり場': { type: 'minPower', minPower: 100 },
    '生徒会室': { type: 'rarityMultiplier', rarities: ['N'], multiplier: 2 },
    'ダンスステージ': { type: 'clubMultiplier', clubs: ['ダンス部'], multiplier: 2 },
    'カフェバー': { type: 'clubMultiplier', clubs: ['いんしゅ部', 'びしょく・りょうり部'], multiplier: 2 },
    'ポータル': { type: 'clubMultiplier', clubs: ['えんそく部'], multiplier: 3 },
    '作業部屋': { type: 'onlyClub', clubs: ['さぎょう部'] },
  };

  const WORK_ORDER = Object.keys(WORK_RULES);
  const GLOBAL_WORK_PRIORITY = [
    'ダンスステージ',
    'カフェバー',
    'ポータル',
    '作業部屋',
    'たまり場',
    '生徒会室',
  ];
  const WORK_DOM_IDS = {
    'たまり場': 'tamari',
    '生徒会室': 'council',
    'ダンスステージ': 'dance',
    'カフェバー': 'cafe',
    'ポータル': 'portal',
    '作業部屋': 'workshop',
  };

  const state = {
    cards: [],
    works: [],
    singleResults: {},
    globalPlan: null,
    cacheIndexLoaded: false,
  };

  const CACHE_INDEX_KEY = 'cpcc_optimizer_cache_index_v1';
  const CACHE_KEY_PREFIX = 'cpcc_optimizer_cache_v1:';
  const OPTION_SCAN_CACHE_KEY_PREFIX = 'cpcc_optimizer_option_scan_v1:';

  // =========================
  // 初期化
  // =========================

  function boot() {
    if (document.getElementById('cpcc-optimizer-root')) return;
    ensureLauncherButton();
    createPanel();
    reloadAll();
  }

  function reloadAll() {
    const allOwnedRoots = findOwnedCardRoots();
    state.cards = parseOwnedCardsRobust();
    state.works = detectWorks();
    setStatus(`総所持 ${allOwnedRoots.length} 枚 / 未使用 ${state.cards.length} 枚 / ワーク ${state.works.filter(w => w.unlocked).length} 件を読み込みました`);
    setResultHtml(renderLoadedPreview());
    void pruneInvalidCachedSearches();
  }

  function syncStateSilently() {
    const allOwnedRoots = findOwnedCardRoots();
    state.cards = parseOwnedCardsRobust();
    state.works = detectWorks();
    setStatus(`総所持 ${allOwnedRoots.length} 枚 / 未使用 ${state.cards.length} 枚 / ワーク ${state.works.filter(w => w.unlocked).length} 件を再同期しました`);
    void pruneInvalidCachedSearches();
  }

  // =========================
  // UI
  // =========================

  function createPanel() {
    const root = document.createElement('div');
    root.id = 'cpcc-optimizer-root';
    root.innerHTML = `
      <div class="cpcc-head">CPCC Deck Optimizer</div>
      <div class="cpcc-actions">
        <button id="cpcc-reload">再読込</button>
        <button id="cpcc-run-all">全ワーク最適化</button>
        <button id="cpcc-close">閉じる</button>
      </div>
      <div id="cpcc-status">初期化中...</div>
      <div class="cpcc-work-buttons">
        ${WORK_ORDER.map(w => `<button data-work="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('')}
      </div>
      <div id="cpcc-result"></div>
    `;
    document.body.appendChild(root);
    updateLauncherVisibility(false);

    if (!document.getElementById('cpcc-optimizer-style')) {
      const style = document.createElement('style');
      style.id = 'cpcc-optimizer-style';
      style.textContent = `
        #cpcc-optimizer-launcher{
          position:fixed;
          right:16px;
          top:16px;
          z-index:999998;
          border:none;
          border-radius:999px;
          padding:10px 14px;
          cursor:pointer;
          background:#2563eb;
          color:#fff;
          font-size:12px;
          font-weight:700;
          box-shadow:0 12px 30px rgba(0,0,0,.28);
        }
        #cpcc-optimizer-launcher:hover{filter:brightness(1.08)}
        #cpcc-optimizer-root{
          position:fixed;
          right:16px;
          top:16px;
          bottom:auto;
          z-index:999999;
          width:400px;
          max-height:80vh;
          overflow:auto;
          background:rgba(16,24,39,.95);color:#fff;
          border-radius:12px;padding:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);
          font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          font-size:12px;line-height:1.45;
        }
        #cpcc-optimizer-root button{
          border:none;border-radius:8px;padding:7px 10px;margin:2px;
          cursor:pointer;background:#2563eb;color:#fff;font-size:12px;
        }
        #cpcc-optimizer-root button:hover{filter:brightness(1.08)}
        #cpcc-optimizer-root .danger{background:#dc2626}
        #cpcc-optimizer-root .green{background:#16a34a}
        #cpcc-optimizer-root .gray{background:#475569}
        .cpcc-head{font-weight:700;font-size:14px;margin-bottom:8px}
        .cpcc-actions,.cpcc-work-buttons{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
        #cpcc-status{margin-bottom:8px;padding:8px;border-radius:8px;background:rgba(255,255,255,.08)}
        #cpcc-result{max-height:none;overflow:visible;padding-right:4px}
        .cpcc-card{padding:8px 10px;margin:6px 0;border-radius:8px;background:rgba(255,255,255,.08)}
        .cpcc-muted{opacity:.85}
        .cpcc-score{font-weight:700;color:#93c5fd}
        .cpcc-title{font-weight:700;font-size:13px;margin-bottom:4px}
        .cpcc-sub{font-size:11px;opacity:.8}
        .cpcc-btns{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
        .cpcc-hr{height:1px;background:rgba(255,255,255,.12);margin:8px 0}
        .cpcc-warn{color:#fbbf24}
        .cpcc-ok{color:#86efac}
        
        .cpcc-highlight-card{
          outline: 8px solid #22c55e !important;
          outline-offset: -3px !important;
          box-shadow:
            0 0 0 6px rgba(34,197,94,.35),
            0 0 30px rgba(34,197,94,.75),
            inset 0 0 0 3px rgba(255,255,255,.85) !important;
          border-radius: 14px !important;
          position: relative;
          z-index: 5 !important;
          transition: box-shadow .15s ease, outline-color .15s ease;
        }

        .cpcc-highlight-badge{
          position: absolute;
          left: 8px;
          top: 8px;
          background: rgba(34,197,94,.98);
          color: #fff;
          font-size: 12px;
          font-weight: 800;
          padding: 4px 8px;
          border-radius: 999px;
          pointer-events: none;
          z-index: 6;
          box-shadow: 0 2px 10px rgba(0,0,0,.25);
        }
        .cpcc-result-card{
          cursor: pointer;
          transition: transform .12s ease, background-color .12s ease;
        }

        .cpcc-result-card:hover{
          transform: translateY(-1px);
          background: rgba(255,255,255,.14);
        }

        .cpcc-result-card.is-active-jump{
          outline: 3px solid #60a5fa;
          box-shadow: 0 0 18px rgba(96,165,250,.55);
        }
      `;
      document.head.appendChild(style);
    }

    root.querySelector('#cpcc-reload').addEventListener('click', reloadAll);
    root.querySelector('#cpcc-run-all').addEventListener('click', runGlobalOptimization);
    root.querySelector('#cpcc-close').addEventListener('click', () => hidePanel());

    root.querySelectorAll('[data-work]').forEach(btn => {
      btn.addEventListener('click', () => runSingleWork(btn.dataset.work));
    });
  }

  function ensureLauncherButton() {
    if (document.getElementById('cpcc-optimizer-launcher')) return;
    const btn = document.createElement('button');
    btn.id = 'cpcc-optimizer-launcher';
    btn.textContent = 'Optimizerを開く';
    btn.style.display = 'none';
    btn.addEventListener('click', showPanel);
    document.body.appendChild(btn);
  }

  function hidePanel() {
    const root = document.getElementById('cpcc-optimizer-root');
    if (!root) return;
    root.style.display = 'none';
    updateLauncherVisibility(true);
  }

  function showPanel() {
    const root = document.getElementById('cpcc-optimizer-root');
    if (!root) {
      boot();
      return;
    }
    root.style.display = '';
    updateLauncherVisibility(false);
  }

  function updateLauncherVisibility(show) {
    const btn = document.getElementById('cpcc-optimizer-launcher');
    if (!btn) return;
    btn.style.display = show ? '' : 'none';
  }

  function setStatus(text) {
    const el = document.getElementById('cpcc-status');
    if (el) el.textContent = text;
  }

  function setResultHtml(html) {
    const el = document.getElementById('cpcc-result');
    if (el) el.innerHTML = html;
    bindResultButtons();
  }

  function bindResultButtons() {
    document.querySelectorAll('[data-cpcc-action="set-work"]').forEach(btn => {
      btn.onclick = async () => {
        const workName = btn.dataset.work;
        const single = state.singleResults?.[workName];
        const plan = single || state.globalPlan?.byWork?.[workName];
        if (!plan) {
          alert('先に対象ワークの最適化を実行してください');
          return;
        }

        btn.disabled = true;
        try {
          await autoSetWorkDeck(workName, plan.deck);
        } finally {
          btn.disabled = false;
        }
      };
    });

    document.querySelectorAll('[data-cpcc-action="set-global"]').forEach(btn => {
      btn.onclick = async () => {
        if (!state.globalPlan?.byWork) {
          alert('先に全ワーク最適化を実行してください');
          return;
        }

        btn.disabled = true;
        try {
          await autoSetGlobalPlan(state.globalPlan.byWork);
        } finally {
          btn.disabled = false;
        }
      };
    });

    document.querySelectorAll('[data-cpcc-action="highlight-work"]').forEach(btn => {
      btn.onclick = () => {
        const workName = btn.dataset.work;
        const single = state.singleResults?.[workName];
        const plan = state.globalPlan?.byWork?.[workName] || single;
        if (!plan?.deck?.length) {
          alert('ハイライト対象のデッキがありません');
          return;
        }

        clearAllHighlights();
        highlightDeck(plan.deck, workName);
        setStatus(`${workName}: ${plan.deck.length} 枚をハイライトしました`);
      };
    });

    document.querySelectorAll('.cpcc-result-card').forEach(el => {
      el.onclick = () => {
        const cardId = el.dataset.cpccCardId;
        const cardName = el.dataset.cpccCardName;
        const cardSignature = el.dataset.cpccCardSig || '';
        const card = state.cards.find(c => c.id === cardId)
          || findCardBySignature(cardSignature);
        if (!card) {
          setStatus(`カード位置が見つかりません: ${cardName}`);
          return;
        }
        const target = findCardRootForJump(card);
        if (!target) return;

        jumpToOwnedCardRoot(target, cardName, el);
      };
    });
  }

  function jumpToOwnedCard(card, resultEl = null) {
    const target = findCardRootForJump(card);
    if (!target) {
      setStatus(`カード位置が見つかりません: ${card.name}`);
      return;
    }

    jumpToOwnedCardRoot(target, card.name, resultEl);
  }

  function jumpToOwnedCardRoot(target, cardName, resultEl = null) {
    if (!target) {
      setStatus(`カード位置が見つかりません: ${cardName}`);
      return;
    }

    try {
      target.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      });
    } catch { }

    flashJumpTarget(target);

    if (resultEl) {
      document.querySelectorAll('.cpcc-result-card.is-active-jump').forEach(el => {
        el.classList.remove('is-active-jump');
      });
      resultEl.classList.add('is-active-jump');
      setTimeout(() => resultEl.classList.remove('is-active-jump'), 1200);
    }

    setStatus(`カード位置へ移動: ${cardName}`);
  }

  function flashJumpTarget(el) {
    if (!el) return;

    const oldTransition = el.style.transition;
    const oldOutline = el.style.outline;
    const oldBoxShadow = el.style.boxShadow;
    const oldZIndex = el.style.zIndex;

    el.style.transition = 'all .12s ease';
    el.style.outline = '10px solid #f59e0b';
    el.style.boxShadow = '0 0 0 8px rgba(245,158,11,.35), 0 0 40px rgba(245,158,11,.8)';
    el.style.zIndex = '8';

    setTimeout(() => {
      el.style.outline = oldOutline;
      el.style.boxShadow = oldBoxShadow;
      el.style.zIndex = oldZIndex;
      el.style.transition = oldTransition;
    }, 1200);
  }

  function renderLoadedPreview() {
    const cards = state.cards;
    const works = state.works;

    const previewCards = cards.slice(0, 6).map(c => {
      const eff = c.effects.length
        ? c.effects.map(e => `${e.club} ${e.value > 0 ? '+' : ''}${e.value}%`).join(', ')
        : '効果なし';
      return `
        <div class="cpcc-card">
          <div class="cpcc-title">${escapeHtml(c.name)} <span class="cpcc-sub">[${escapeHtml(c.rarity)}]</span></div>
          <div>Power: ${c.power} / 部活: ${escapeHtml(c.club)}</div>
          <div class="cpcc-muted">${escapeHtml(eff)}</div>
        </div>
      `;
    }).join('');

    const workInfo = works.map(w => {
      return `
        <div class="cpcc-card">
          <div class="cpcc-title">${escapeHtml(w.name)}</div>
          <div>${w.unlocked ? '<span class="cpcc-ok">解放済み</span>' : '<span class="cpcc-warn">未解放</span>'}</div>
          <div class="cpcc-sub">現在 ${w.currentCount}/5</div>
        </div>
      `;
    }).join('');

    return `
      <div class="cpcc-card">
        <div class="cpcc-title">読込結果</div>
        <div>カード: ${cards.length} 枚</div>
        <div>ワーク: ${works.filter(w => w.unlocked).length} 件解放済み</div>
      </div>
      ${previewCards}
      <div class="cpcc-hr"></div>
      ${workInfo}
    `;
  }

  function renderLiveSearchPreview(workName, bestOption, progress = {}) {
    const title = progress.mode === 'global'
      ? `全ワーク最適化中: ${workName} の暫定トップ`
      : `${workName} 探索中の暫定トップ`;
    const detail = bestOption?.detail || getFreshDeckDetail(workName, bestOption?.deck || [], null) || { total: 0, byCard: {} };
    const deck = bestOption?.deck || [];
    const progressText = progress.totalGroups
      ? `軸 ${formatNum(progress.processedGroups || 0)} / ${formatNum(progress.totalGroups || 0)} / 試行 ${formatNum(progress.explored || 0)}`
      : `試行 ${formatNum(progress.explored || 0)}`;

    return `
      <div class="cpcc-card">
        <div class="cpcc-title">${escapeHtml(title)}</div>
        <div class="cpcc-score">暫定Power: ${formatNum(bestOption?.score || 0)}</div>
        <div class="cpcc-sub">${escapeHtml(progressText)}</div>
      </div>
      ${renderDeckCards(deck, detail)}
    `;
  }

  // =========================
  // カード読み込み
  // =========================

  function parseOwnedCardsRobust() {
    const roots = findOwnedCardRoots();
    const usedCardCounts = collectUsedCardCounts();
    const cards = [];

    roots.forEach((root, index) => {
      const card = parseCardFromRoot(root, index);
      if (card) {
        root.dataset.cpccOwnedCardId = card.id;
        const signatureKey = getCardSignatureKey(card);
        if (usedCardCounts.get(signatureKey) > 0) {
          usedCardCounts.set(signatureKey, usedCardCounts.get(signatureKey) - 1);
          return;
        }

        if (!card.inDeck) {
          cards.push(card);
        }
      }
    });

    return cards;
  }

  function findOwnedCardRoots() {
    const deleteButtons = [...document.querySelectorAll('button')]
      .filter(btn => normalizeSpace(btn.textContent).includes('✖'));

    const roots = [];
    const seen = new Set();

    for (const btn of deleteButtons) {
      const root = findCardRootFromDeleteButton(btn);
      if (!root) continue;
      if (seen.has(root)) continue;
      seen.add(root);
      roots.push(root);
    }

    return roots;
  }

  function findCardRootFromDeleteButton(btn) {
    let current = btn.parentElement;
    while (current && current !== document.body) {
      const text = normalizeSpace(current.innerText || current.textContent || '');
      const hasPower = /Power\s*\d+/i.test(text);
      const hasDelete = [...current.querySelectorAll('button')]
        .some(b => normalizeSpace(b.textContent).includes('✖'));
      const hasMainImage = !!findMainCardImage(current);

      if (hasPower && hasDelete && hasMainImage) {
        return current;
      }

      current = current.parentElement;
    }
    return null;
  }

  function findMainCardImage(root) {
    const imgs = [...root.querySelectorAll('img[alt]')];
    return imgs.find(img => {
      const alt = (img.getAttribute('alt') || '').trim();
      const src = (img.getAttribute('src') || '').trim();
      if (!alt) return false;
      if (src.includes('icon_')) return false;
      if (alt === 'からぱり☆カードコレクション!') return false;
      if (['N', 'R', 'SR', 'SSR'].includes(alt)) return false;
      return true;
    }) || null;
  }

  function parseCardFromRoot(root, index) {
    const info = parseCardSignature(root);
    if (!info?.name || info.power == null || !info.club) return null;

    const effects = parseEffectsFromRoot(root);

    return {
      id: `${info.name}__${info.power}__${info.club}__${info.rarity}__${index}`,
      name: info.name,
      power: info.power,
      club: info.club,
      rarity: info.rarity,
      effects,
      inDeck: root.classList.contains('in-deck'),
      root,
    };
  }

  function parseRarity(root) {
    const imgs = [...root.querySelectorAll('img[alt]')];
    for (const img of imgs) {
      const alt = (img.getAttribute('alt') || '').trim();
      const src = (img.getAttribute('src') || '').trim();
      if (src.includes('icon_') && ['N', 'R', 'SR', 'SSR'].includes(alt)) {
        return alt;
      }
    }
    const text = normalizeSpace(root.innerText || root.textContent || '');
    const m = text.match(/\b(SSR|SR|R|N)\b/);
    return m ? m[1] : null;
  }

  function parseClub(text) {
    return CLUBS.find(club => text.includes(club)) || null;
  }

  function parseClubFromRoot(root, fallbackText = '') {
    const clubCandidates = [
      root.querySelector('.card-club .club-text'),
      root.querySelector('.club-text'),
      root.querySelector('.card-club'),
    ].filter(Boolean);

    for (const el of clubCandidates) {
      const text = normalizeSpace(el.textContent || '');
      const club = parseClub(text);
      if (club) return club;
    }

    return fallbackText ? parseClub(fallbackText) : null;
  }

  function parseEffects(text) {
    const effects = [];
    for (const club of CLUBS) {
      const escaped = escapeRegExp(club);
      const re = new RegExp(`${escaped}\\s*([+-]\\d+)%`, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        effects.push({
          club,
          value: Number(m[1]),
        });
      }
    }
    return effects;
  }

  function parseEffectsFromRoot(root) {
    const effects = [];
    const badgeTexts = [...root.querySelectorAll('.card-options [title]')]
      .map(el => (el.getAttribute('title') || '').trim())
      .filter(Boolean);

    if (badgeTexts.length) {
      for (const text of badgeTexts) {
        const club = parseClub(text);
        const valueMatch = text.match(/([+-]\d+)%/);
        if (!club || !valueMatch) continue;

        effects.push({
          club,
          value: Number(valueMatch[1]),
        });
      }
      return effects;
    }

    const text = normalizeSpace(root.innerText || root.textContent || '');
    return parseEffects(text);
  }

  function getEffectsSignature(effects) {
    return [...(effects || [])]
      .map(eff => `${eff.club}:${eff.value}`)
      .sort()
      .join('|');
  }

  function getCardSignatureKey(card) {
    return [card.name, card.power, card.club, card.rarity, getEffectsSignature(card.effects)].join('__');
  }

  function getCardRootSignatureKey(root) {
    const parsed = parseCardFromRoot(root, 'sig');
    return parsed ? getCardSignatureKey(parsed) : null;
  }

  function findCardBySignature(signature) {
    if (!signature) return null;

    const ownedCard = state.cards.find(card => getCardSignatureKey(card) === signature);
    if (ownedCard) return ownedCard;

    for (const workName of WORK_ORDER) {
      const workCard = getCardsCurrentlyInWork(workName)
        .find(card => getCardSignatureKey(card) === signature);
      if (workCard) return workCard;
    }

    return null;
  }

  function getCardsCurrentlyInWork(workName) {
    const root = findWorkRoot(workName);
    if (!root) return [];

    return findFilledWorkCardRoots(root)
      .map((cardRoot, index) => {
        const card = parseCardFromRoot(cardRoot, `work-${workName}-${index}`);
        if (!card) return null;
        return {
          ...card,
          inDeck: false,
        };
      })
      .filter(Boolean);
  }

  function collectUsedCardCounts() {
    const counts = new Map();

    for (const workName of WORK_ORDER) {
      const root = findWorkRoot(workName);
      if (!root) continue;

      for (const cardRoot of findFilledWorkCardRoots(root)) {
        const key = getCardRootSignatureKey(cardRoot);
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    return counts;
  }

  // =========================
  // ワーク読み込み
  // =========================

  function detectWorks() {
    let previousUnlocked = true;

    return WORK_ORDER.map(name => {
      const root = findWorkRoot(name);
      const selfUnlocked = !!root && !normalizeSpace(root.innerText || root.textContent || '').includes('解放する');
      const unlocked = previousUnlocked && selfUnlocked;
      const count = root ? parseCurrentCount(root) : 0;
      previousUnlocked = unlocked;
      return { name, root, unlocked, currentCount: count };
    });
  }

  function findWorkRoot(workName) {
    const baseId = WORK_DOM_IDS[workName];
    if (baseId) {
      const direct = document.getElementById(`base-${baseId}`);
      if (direct) return direct;
    }

    const all = [...document.querySelectorAll('div, section, article')];
    let best = null;
    let bestScore = -Infinity;

    for (const el of all) {
      const text = normalizeSpace(el.innerText || el.textContent || '');
      if (!text.includes(workName)) continue;
      if (!text.includes('累計パワー')) continue;

      let score = 0;
      if (text.includes('オプション効果')) score += 20;
      if (text.includes(workName)) score += 20;
      if (text.includes('5/5') || text.includes('0/5') || /[0-5]\/5/.test(text)) score += 10;
      score -= text.length / 200;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  }

  function parseCurrentCount(workRoot) {
    const text = normalizeSpace(workRoot.innerText || workRoot.textContent || '');
    const m = text.match(/([0-5])\/5/);
    return m ? Number(m[1]) : 0;
  }

  // =========================
  // 評価ロジック
  // =========================

  function roundPower(value) {
    const v = Math.max(0, value);
    if (POWER_ROUND_MODE === 'ceil') return Math.ceil(v);
    if (POWER_ROUND_MODE === 'round') return Math.round(v);
    return Math.floor(v);
  }

  function applyWorkBase(card, rule) {
    return applyWorkPower(card.power, card, rule);
  }

  function applyWorkPower(power, card, rule) {
    if (!rule) return power;

    if (rule.type === 'minPower') {
      return Math.max(power, rule.minPower);
    }

    if (rule.type === 'rarityMultiplier') {
      return rule.rarities.includes(card.rarity)
        ? power * rule.multiplier
        : power;
    }

    if (rule.type === 'clubMultiplier') {
      return rule.clubs.includes(card.club)
        ? power * rule.multiplier
        : power;
    }

    if (rule.type === 'onlyClub') {
      return rule.clubs.includes(card.club)
        ? power
        : 0;
    }

    return power;
  }

  function evaluateDeck(deck, rule) {
    const buffByClub = new Map();
    for (const card of deck) {
      for (const eff of card.effects) {
        buffByClub.set(eff.club, (buffByClub.get(eff.club) || 0) + eff.value);
      }
    }

    const byCard = {};
    let totalRaw = 0;

    for (const card of deck) {
      const clubBonus = buffByClub.get(card.club) || 0;
      const basePower = card.power;
      const bonusPower = basePower * (clubBonus / 100);
      const afterClubBonus = Math.max(0, basePower + bonusPower);
      const finalPower = applyWorkPower(afterClubBonus, card, rule);
      const fieldPower = finalPower - afterClubBonus;
      const fieldLabel = describeFieldEffect(card, rule, afterClubBonus, finalPower);

      byCard[card.id] = {
        bonusPercent: clubBonus,
        basePower,
        bonusPower,
        afterClubBonus,
        fieldPower,
        finalPower,
        fieldLabel,
      };
      totalRaw += finalPower;
    }

    return {
      total: roundPower(totalRaw),
      totalRaw,
      byCard,
    };
  }

  function describeFieldEffect(card, rule, afterClubBonus, finalPower) {
    if (!rule) return 'なし';

    if (rule.type === 'minPower') {
      return afterClubBonus < rule.minPower ? `最低${rule.minPower}` : 'なし';
    }

    if (rule.type === 'rarityMultiplier' && rule.rarities?.includes(card.rarity)) {
      return `x${rule.multiplier}`;
    }

    if (rule.type === 'clubMultiplier' && rule.clubs?.includes(card.club)) {
      return `x${rule.multiplier}`;
    }

    if (rule.type === 'onlyClub') {
      return finalPower > 0 ? '適用' : '対象外';
    }

    return 'なし';
  }

  function computeCardOptionMetrics(card) {
    const buffByClub = new Map();
    const slotByClub = new Map();
    let positiveTotal = 0;
    let negativeTotal = 0;

    for (const eff of card.effects) {
      if (eff.value > 0) {
        positiveTotal += eff.value;
        buffByClub.set(eff.club, (buffByClub.get(eff.club) || 0) + eff.value);
        slotByClub.set(eff.club, (slotByClub.get(eff.club) || 0) + 1);
      } else if (eff.value < 0) {
        negativeTotal += Math.abs(eff.value);
      }
    }

    let maxBuffClub = card.club;
    let maxBuffTotal = 0;
    let maxBuffSlots = 0;
    for (const [club, total] of buffByClub.entries()) {
      const slots = slotByClub.get(club) || 0;
      if (
        total > maxBuffTotal
        || (total === maxBuffTotal && slots > maxBuffSlots)
      ) {
        maxBuffClub = club;
        maxBuffTotal = total;
        maxBuffSlots = slots;
      }
    }

    const ownPositive = buffByClub.get(card.club) || 0;
    const ownSlots = slotByClub.get(card.club) || 0;
    const optionScore = (positiveTotal * 8) + (maxBuffTotal * 14) + (maxBuffSlots * 900) + (ownPositive * 5) - (negativeTotal * 4);

    return {
      positiveTotal,
      negativeTotal,
      ownPositive,
      ownSlots,
      maxBuffClub,
      maxBuffTotal,
      maxBuffSlots,
      buffByClub,
      slotByClub,
      optionScore,
    };
  }

  function getOptionScanInfo(card, optionScan = null) {
    return optionScan?.byId?.get(card.id) || computeCardOptionMetrics(card);
  }

  function getTargetOptionMetrics(metrics, rule) {
    const targetClubs = new Set(rule.clubs || []);
    let targetPositive = 0;
    let targetSlots = 0;

    for (const club of targetClubs) {
      targetPositive += metrics.buffByClub?.get(club) || 0;
      targetSlots += metrics.slotByClub?.get(club) || 0;
    }

    return { targetPositive, targetSlots };
  }

  function estimateOptionFitForRule(card, rule, metrics) {
    const { targetPositive, targetSlots } = getTargetOptionMetrics(metrics, rule);
    let score = metrics.optionScore;

    if (rule.type === 'clubMultiplier') {
      score += targetPositive * 22;
      score += targetSlots * 1800;
      if (rule.clubs.includes(card.club)) {
        score += card.power * rule.multiplier * 1.35;
        score += metrics.ownPositive * 12;
        score += metrics.ownSlots * 500;
      } else if (targetPositive === 0) {
        score -= 2200;
      }
    } else if (rule.type === 'onlyClub') {
      score += targetPositive * 24;
      score += targetSlots * 2200;
      if (rule.clubs.includes(card.club)) {
        score += card.power * 1.8;
        score += metrics.ownPositive * 10;
      } else {
        score -= 12000;
      }
    } else if (rule.type === 'rarityMultiplier') {
      score += metrics.positiveTotal * 10;
      score += metrics.maxBuffTotal * 8;
      if (rule.rarities?.includes(card.rarity)) {
        score += card.power * rule.multiplier * 1.2;
        score += metrics.ownPositive * 8;
      } else if (metrics.positiveTotal === 0) {
        score -= 1800;
      }
    } else if (rule.type === 'minPower') {
      score += metrics.positiveTotal * 12;
      score += metrics.maxBuffTotal * 10;
      score += metrics.maxBuffSlots * 500;
      if (card.power < rule.minPower) {
        score += (rule.minPower - card.power) * 3.5;
        score += metrics.ownPositive * 5;
      } else {
        score += card.power * 0.45;
      }
    }

    return {
      score,
      targetPositive,
      targetSlots,
    };
  }

  function getBestFocusClubForRule(rule, metrics, fallbackClub) {
    const targetClubs = rule.clubs || [];
    let bestClub = '';
    let bestTotal = -1;

    for (const club of targetClubs) {
      const total = metrics.buffByClub?.get(club) || 0;
      if (total > bestTotal) {
        bestClub = club;
        bestTotal = total;
      }
    }

    return bestTotal > 0 ? bestClub : (metrics.maxBuffClub || fallbackClub);
  }

  function estimateCardValue(card, rule, analysis = null, optionScan = null) {
    const cached = analysis?.byId?.get(card.id);
    if (cached) return cached.estimateCardValue;

    const baseScore = applyWorkBase(card, rule);
    const tier = getCardTierProfile(card, rule);
    const metrics = getOptionScanInfo(card, optionScan);
    const optionFit = estimateOptionFitForRule(card, rule, metrics);

    return (baseScore * 0.8) + optionFit.score + tier.score;
  }

  function createCardAnalysis(cards, rule, optionScan = null) {
    const byId = new Map();

    for (const card of cards) {
      const baseScore = applyWorkBase(card, rule);
      const tier = getCardTierProfile(card, rule);
      const metrics = getOptionScanInfo(card, optionScan);
      const optionFit = estimateOptionFitForRule(card, rule, metrics);
      const estimate = (baseScore * 0.8) + optionFit.score + tier.score;

      byId.set(card.id, {
        baseScore,
        tier,
        focusClub: optionFit.targetPositive > 0
          ? getBestFocusClubForRule(rule, metrics, tier.focusClub)
          : (metrics.maxBuffClub || tier.focusClub),
        ownPositive: metrics.ownPositive,
        relevantPositive: optionFit.targetPositive,
        otherPositive: Math.max(0, metrics.positiveTotal - metrics.ownPositive - optionFit.targetPositive),
        positiveTotal: metrics.positiveTotal,
        positiveSlots: metrics.maxBuffSlots,
        targetPositive: optionFit.targetPositive,
        targetSlots: optionFit.targetSlots,
        optionScore: metrics.optionScore,
        maxBuffClub: metrics.maxBuffClub,
        maxBuffTotal: metrics.maxBuffTotal,
        maxBuffSlots: metrics.maxBuffSlots,
        estimateCardValue: estimate,
      });
    }

    return { byId };
  }

  function prefilterCardsForSearch(cards, rule, optionScan = null) {
    const sourceCards = getRuleRelevantCards(cards, rule);
    const ranked = [...sourceCards].sort((a, b) => estimateCardValueFast(b, rule, optionScan) - estimateCardValueFast(a, rule, optionScan));
    const picked = [];
    const seen = new Set();

    const pushCard = (card) => {
      if (!card || seen.has(card.id)) return;
      seen.add(card.id);
      picked.push(card);
    };

    ranked.slice(0, CONFIG.prefilterOverallKeep).forEach(pushCard);

    for (const club of getFastFocusClubs(ranked, rule)) {
      ranked
        .filter(card => card.club === club || card.effects.some(eff => eff.value > 0 && eff.club === club))
        .slice(0, CONFIG.prefilterPerClubKeep)
        .forEach(pushCard);
    }

    if (rule.type === 'minPower') {
      ranked
        .filter(card => card.power < rule.minPower)
        .slice(0, CONFIG.prefilterMinPowerExtraKeep)
        .forEach(pushCard);
    }

    return picked;
  }

  function estimateCardValueFast(card, rule, optionScan = null) {
    const metrics = getOptionScanInfo(card, optionScan);
    const optionFit = estimateOptionFitForRule(card, rule, metrics);
    return (applyWorkBase(card, rule) * 0.7) + optionFit.score;
  }

  function getFastFocusClubs(rankedCards, rule) {
    if (rule.clubs?.length) return [...new Set(rule.clubs)];

    const scores = new Map();
    for (const card of rankedCards.slice(0, CONFIG.prefilterOverallKeep)) {
      const fastScore = estimateCardValueFast(card, rule);
      scores.set(card.club, (scores.get(card.club) || 0) + fastScore);
      for (const eff of card.effects) {
        if (eff.value <= 0) continue;
        scores.set(eff.club, (scores.get(eff.club) || 0) + eff.value * 8);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CONFIG.prefilterFocusClubCount)
      .map(([club]) => club);
  }

  function buildCandidates(cards, rule, analysis = null, optionScan = null) {
    const sourceCards = getRuleRelevantCards(cards, rule);
    const ranked = [...sourceCards].sort((a, b) => estimateCardValue(b, rule, analysis, optionScan) - estimateCardValue(a, rule, analysis, optionScan));
    const picked = [];
    const seen = new Set();

    const pushCard = (card) => {
      if (!card || seen.has(card.id)) return;
      seen.add(card.id);
      picked.push(card);
    };

    ranked.slice(0, CONFIG.candidateOverallKeep).forEach(pushCard);

    for (const club of getCandidateFocusClubs(ranked, rule, analysis)) {
      ranked
        .filter(card => {
          const info = analysis?.byId?.get(card.id);
          return card.club === club || info?.focusClub === club;
        })
        .slice(0, CONFIG.candidatePerClubKeep)
        .forEach(pushCard);
    }

    if (rule.type === 'minPower') {
      ranked
        .filter(card => card.power < rule.minPower)
        .slice(0, CONFIG.candidateMinPowerExtraKeep)
        .forEach(pushCard);
    }

    return picked;
  }

  function getRuleRelevantCards(cards, rule) {
    if (!rule?.clubs?.length) return cards;

    const targetClubs = new Set(rule.clubs);
    const relevant = cards.filter(card => {
      if (targetClubs.has(card.club)) return true;
      return card.effects.some(eff => eff.value > 0 && targetClubs.has(eff.club));
    });

    // 候補を絞りすぎると探索漏れになるので、少なすぎる場合は元に戻す
    return relevant.length >= Math.min(40, cards.length) ? relevant : cards;
  }

  function getCandidateFocusClubs(rankedCards, rule, analysis = null) {
    if (rule.clubs?.length) return [...new Set(rule.clubs)];

    const scores = new Map();
    for (const card of rankedCards.slice(0, CONFIG.candidateOverallKeep)) {
      const info = analysis?.byId?.get(card.id);
      const estimate = info?.estimateCardValue ?? 0;
      const clubs = [card.club, info?.focusClub].filter(Boolean);
      for (const club of clubs) {
        scores.set(club, (scores.get(club) || 0) + estimate);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CONFIG.candidateFocusClubCount)
      .map(([club]) => club);
  }

  async function searchTopDeckOptions(cards, workName, maxKeep = CONFIG.topDeckOptionsPerWork, onProgress = null, opts = {}) {
    const rule = WORK_RULES[workName];
    const seedDeck = opts.seedDeck || [];
    const cacheKey = buildSearchCacheKey(cards, workName, seedDeck);
    const cached = await loadSearchCache(cacheKey, cards, workName);
    if (cached) {
      onProgress?.(`${workName}: 保存済みキャッシュを使用しました`);
      return cached;
    }

    const optionScan = await getOrCreateOptionScan(cards);
    const prefilteredCards = prefilterCardsForSearch(cards, rule, optionScan);
    const analysis = createCardAnalysis(prefilteredCards, rule, optionScan);
    const candidates = buildCandidates(prefilteredCards, rule, analysis, optionScan);
    const emptyOption = {
      workName,
      deck: [],
      score: 0,
      detail: { total: 0, byCard: {} },
      key: '',
      exploredAt: 0,
    };

    if (candidates.length === 0) {
      const result = {
        workName,
        rule,
        candidates,
        options: [emptyOption],
        explored: 0,
      };
      await saveSearchCache(cacheKey, cards, workName, result);
      return result;
    }

    const progress = createSynergySearchProgress(workName, onProgress);
    const exactResult = await enumerateTopDeckOptionsBySynergy(candidates, rule, analysis, optionScan, {
      maxKeep,
      workName,
      onProgress: progress.report,
    });
    const swapSeedResult = enumerateTopDeckOptionsAroundCurrentDeck(cards, seedDeck, candidates, rule, analysis, optionScan, {
      maxKeep,
      workName,
    });

    const options = [emptyOption, ...exactResult.options, ...swapSeedResult.options]
      .filter((option, index, arr) => arr.findIndex(x => x.key === option.key) === index)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxKeep);

    if (!options.some(option => option.key === '')) {
      options.push(emptyOption);
    }

    options.sort((a, b) => b.score - a.score);
    const result = {
      workName,
      rule,
      candidates,
      options,
      explored: exactResult.explored + swapSeedResult.explored,
    };
    await saveSearchCache(cacheKey, cards, workName, result);
    return result;
  }

  async function enumerateTopDeckOptionsBySynergy(candidates, rule, analysis, optionScan, { maxKeep, workName, onProgress }) {
    const bestOptions = [];
    const ticker = createOptimizationTicker();
    const seenDeckKeys = new Set();
    let explored = 0;
    let processedGroups = 0;
    const anchorCards = buildAnchorCards(candidates, rule, analysis, optionScan);
    const anchorPairs = buildAnchorPairs(anchorCards, rule, analysis, optionScan);
    const generalCore = candidates.slice(0, CONFIG.synergyGeneralKeep);

    for (const anchor of anchorCards) {
      await ticker.tick();
      const pool = buildSynergyPool(anchor.deck, candidates, rule, analysis, optionScan, generalCore);
      await enumerateDecksFromPool(anchor.deck, pool);
      processedGroups++;
      onProgress?.({
        processedGroups,
        totalGroups: anchorCards.length + anchorPairs.length,
        explored,
        bestScore: bestOptions[0]?.score || 0,
        bestOption: bestOptions[0] || null,
      });
    }

    for (const anchor of anchorPairs) {
      await ticker.tick();
      const pool = buildSynergyPool(anchor.deck, candidates, rule, analysis, optionScan, generalCore);
      await enumerateDecksFromPool(anchor.deck, pool);
      processedGroups++;
      onProgress?.({
        processedGroups,
        totalGroups: anchorCards.length + anchorPairs.length,
        explored,
        bestScore: bestOptions[0]?.score || 0,
        bestOption: bestOptions[0] || null,
      });
    }

    return {
      options: bestOptions.sort((a, b) => b.score - a.score),
      explored,
    };

    async function enumerateDecksFromPool(anchorDeck, pool) {
      const need = 5 - anchorDeck.length;
      if (need < 0) return;
      if (need === 0) {
        pushDeckOption(anchorDeck);
        return;
      }
      if (pool.length < need) return;

      const picked = [];
      async function dfs(startIndex, left) {
        await ticker.tick();
        if (left === 0) {
          pushDeckOption([...anchorDeck, ...picked]);
          return;
        }

        const lastStart = pool.length - left;
        for (let i = startIndex; i <= lastStart; i++) {
          picked.push(pool[i]);
          await dfs(i + 1, left - 1);
          picked.pop();
        }
      }

      await dfs(0, need);
    }

    function pushDeckOption(deck) {
      const key = deck.map(c => c.id).sort().join('|');
      if (seenDeckKeys.has(key)) return;
      seenDeckKeys.add(key);

      explored++;
      if (explored === 1 || explored % CONFIG.synergyProgressEveryDecks === 0) {
        onProgress?.({
          processedGroups,
          totalGroups: anchorCards.length + anchorPairs.length,
          explored,
          bestScore: bestOptions[0]?.score || 0,
          bestOption: bestOptions[0] || null,
        });
      }

      const detail = evaluateDeck(deck, rule);
      pushBestOption(bestOptions, {
        workName,
        deck: [...deck],
        score: detail.total,
        detail,
        key,
        exploredAt: explored,
      }, maxKeep);
    }
  }

  function enumerateTopDeckOptionsAroundCurrentDeck(cards, currentDeck, candidates, rule, analysis, optionScan, { maxKeep, workName }) {
    const baseDeck = restoreSeedDeck(currentDeck, cards);
    if (!baseDeck.length) {
      return { options: [], explored: 0 };
    }

    const bestOptions = [];
    const seen = new Set();
    let explored = 0;
    const baseIds = new Set(baseDeck.map(card => card.id));
    const replacementPool = [...new Map(
      [...candidates, ...cards]
        .filter(card => !baseIds.has(card.id))
        .map(card => [card.id, card])
    ).values()]
      .map(card => ({
        card,
        score: estimateSynergyWithAnchor(card, baseDeck, rule, analysis, optionScan),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, CONFIG.currentDeckSwapPoolKeep)
      .map(item => item.card);

    pushDeckOption(baseDeck);

    for (let removeIndex = 0; removeIndex < baseDeck.length; removeIndex++) {
      for (const replacement of replacementPool) {
        const deck = baseDeck.filter((_, index) => index !== removeIndex);
        deck.push(replacement);
        if (new Set(deck.map(card => card.id)).size !== deck.length) continue;
        pushDeckOption(deck);
      }
    }

    const pairPool = replacementPool.slice(0, CONFIG.currentDeckPairSwapKeep);
    for (let i = 0; i < baseDeck.length; i++) {
      for (let j = i + 1; j < baseDeck.length; j++) {
        for (let a = 0; a < pairPool.length; a++) {
          for (let b = a + 1; b < pairPool.length; b++) {
            const deck = baseDeck.filter((_, index) => index !== i && index !== j);
            deck.push(pairPool[a], pairPool[b]);
            if (new Set(deck.map(card => card.id)).size !== deck.length) continue;
            pushDeckOption(deck);
          }
        }
      }
    }

    return {
      options: bestOptions.sort((a, b) => b.score - a.score),
      explored,
    };

    function pushDeckOption(deck) {
      if (deck.length !== 5) return;
      const key = deck.map(card => card.id).sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      explored++;

      const detail = evaluateDeck(deck, rule);
      pushBestOption(bestOptions, {
        workName,
        deck: [...deck],
        score: detail.total,
        detail,
        key,
        exploredAt: explored,
      }, maxKeep);
    }
  }

  function restoreSeedDeck(seedDeck, cards) {
    if (!seedDeck?.length) return [];
    return restoreDeckRefs(serializeDeckRefs(seedDeck, seedDeck), cards);
  }

  function buildAnchorCards(candidates, rule, analysis, optionScan = null) {
    return candidates
      .map(card => ({
        deck: [card],
        score: estimateAnchorStrength(card, rule, analysis, optionScan),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(CONFIG.synergyAnchorKeep, candidates.length));
  }

  function buildAnchorPairs(anchorCards, rule, analysis, optionScan = null) {
    const pairSource = anchorCards.slice(0, Math.min(CONFIG.synergyPairAnchorKeep, anchorCards.length));
    const pairs = [];

    for (let i = 0; i < pairSource.length; i++) {
      for (let j = i + 1; j < pairSource.length; j++) {
        const first = pairSource[i].deck[0];
        const second = pairSource[j].deck[0];
        pairs.push({
          deck: [first, second],
          score: estimatePairAnchorStrength(first, second, rule, analysis, optionScan),
        });
      }
    }

    return pairs
      .sort((a, b) => b.score - a.score)
      .slice(0, CONFIG.synergyPairAnchorKeep);
  }

  function buildSynergyPool(anchorDeck, candidates, rule, analysis, optionScan, generalCore) {
    const anchorIds = new Set(anchorDeck.map(card => card.id));
    const pool = [];
    const seen = new Set(anchorIds);

    const pushCard = (card) => {
      if (!card || seen.has(card.id)) return;
      seen.add(card.id);
      pool.push(card);
    };

    const anchorClubs = new Set(anchorDeck.map(card => card.club));
    const boostedClubs = new Set();
    for (const card of anchorDeck) {
      for (const eff of card.effects) {
        if (eff.value > 0) boostedClubs.add(eff.club);
      }
    }

    const ranked = candidates
      .filter(card => !anchorIds.has(card.id))
      .map(card => ({
        card,
        score: estimateSynergyWithAnchor(card, anchorDeck, rule, analysis, optionScan),
      }))
      .sort((a, b) => b.score - a.score);

    ranked.slice(0, CONFIG.synergyPoolKeep).forEach(item => pushCard(item.card));

    candidates
      .filter(card => !anchorIds.has(card.id) && (anchorClubs.has(card.club) || boostedClubs.has(card.club)))
      .slice(0, CONFIG.synergyPoolKeep)
      .forEach(pushCard);

    generalCore.forEach(pushCard);

    return pool.slice(0, Math.max(CONFIG.synergyPoolKeep, 10));
  }

  function estimateAnchorStrength(card, rule, analysis = null, optionScan = null) {
    const info = analysis?.byId?.get(card.id);
    const metrics = getOptionScanInfo(card, optionScan);
    const positiveTotal = info?.positiveTotal ?? metrics.positiveTotal;
    const positiveSlots = info?.positiveSlots ?? metrics.maxBuffSlots;
    const ownPositive = info?.ownPositive ?? metrics.ownPositive;
    const targetPositive = info?.targetPositive ?? getTargetOptionMetrics(metrics, rule).targetPositive;
    return estimateCardValue(card, rule, analysis, optionScan) + positiveTotal * 4 + targetPositive * 10 + positiveSlots * 900 + ownPositive * 4;
  }

  function estimatePairAnchorStrength(cardA, cardB, rule, analysis = null, optionScan = null) {
    const base = estimateAnchorStrength(cardA, rule, analysis, optionScan) + estimateAnchorStrength(cardB, rule, analysis, optionScan);
    const synergy = estimateSynergyWithAnchor(cardA, [cardB], rule, analysis, optionScan) + estimateSynergyWithAnchor(cardB, [cardA], rule, analysis, optionScan);
    return base + synergy;
  }

  function estimateSynergyWithAnchor(card, anchorDeck, rule, analysis = null, optionScan = null) {
    let score = estimateCardValue(card, rule, analysis, optionScan);
    const targetClubs = new Set(rule.clubs || []);

    for (const anchor of anchorDeck) {
      for (const eff of anchor.effects) {
        if (eff.value <= 0) continue;
        if (eff.club === card.club) score += eff.value * 12;
        if (targetClubs.has(eff.club)) score += eff.value * 8;
      }

      for (const eff of card.effects) {
        if (eff.value <= 0) continue;
        if (eff.club === anchor.club) score += eff.value * 9;
        if (targetClubs.has(eff.club)) score += eff.value * 12;
      }

      if (anchor.club === card.club) {
        score += applyWorkBase(card, rule) * 0.3;
      }
    }

    if (rule.type === 'minPower' && card.power < rule.minPower) {
      score += (rule.minPower - card.power) * 4;
    }
    if (rule.type === 'rarityMultiplier' && rule.rarities?.includes(card.rarity)) {
      score += applyWorkBase(card, rule) * 0.35;
    }

    return score;
  }

  function getPositiveBuffStats(card) {
    const byClub = new Map();
    for (const eff of card.effects) {
      if (eff.value <= 0) continue;
      const entry = byClub.get(eff.club) || { slots: 0, total: 0 };
      entry.slots += 1;
      entry.total += eff.value;
      byClub.set(eff.club, entry);
    }
    return byClub;
  }

  function getCardTierProfile(card, rule) {
    const stats = getPositiveBuffStats(card);
    const targetClubs = new Set(rule.clubs || []);
    let best = {
      tier: 0,
      score: 0,
      sortScore: 0,
      focusClub: card.club,
    };

    for (const [club, info] of stats.entries()) {
      const sameClub = club === card.club;
      const homeroomSupport = card.club === '帰宅部';
      const targetBoost = targetClubs.has(club) ? 1200 : 0;
      let tier = 0;
      let score = 0;

      // 高: 同部活3枠以上 / 帰宅部で同系統3枠以上
      if (info.slots >= 3 && (sameClub || homeroomSupport)) {
        tier = 3;
        score = 12000 + info.total * 18 + targetBoost;
      }
      // 中: 他部活3枠以上 / 同部活2枠
      else if (info.slots >= 3) {
        tier = 2;
        score = 7000 + info.total * 12 + targetBoost;
      } else if (info.slots >= 2 && sameClub) {
        tier = 2;
        score = 6200 + info.total * 10 + targetBoost;
      }
      // 低: 2枠支援 or 強い1枠
      else if (info.slots >= 2 || info.total >= 150) {
        tier = 1;
        score = 2600 + info.total * 6 + targetBoost;
      }

      if (tier > best.tier || (tier === best.tier && score > best.score)) {
        best = {
          tier,
          score,
          sortScore: tier * 100000 + score,
          focusClub: club,
        };
      }
    }

    if (best.tier === 0) {
      best.focusClub = card.club;
      best.sortScore = applyWorkBase(card, rule);
    }

    return best;
  }

  function totalPositiveBuffForClub(card, club) {
    return card.effects.reduce((sum, eff) => {
      if (eff.club !== club || eff.value <= 0) return sum;
      return sum + eff.value;
    }, 0);
  }

  function positiveBuffSlotsForClub(card, club) {
    return card.effects.reduce((sum, eff) => {
      if (eff.club !== club || eff.value <= 0) return sum;
      return sum + 1;
    }, 0);
  }

  function pushBestOption(arr, option, maxKeep) {
    if (arr.some(x => x.key === option.key)) return;
    arr.push(option);
    arr.sort((a, b) => b.score - a.score);
    if (arr.length > maxKeep) arr.length = maxKeep;
  }

  async function findBestSingleWork(cards, workName, onProgress = null) {
    const searched = await searchTopDeckOptions(cards, workName, 1, onProgress, {
      seedDeck: getCardsCurrentlyInWork(workName),
    });
    const top = findBestNonEmptyOption(searched.options) || searched.options[0] || { deck: [], score: 0, detail: { total: 0, byCard: {} } };
    return {
      workName,
      deck: top.deck,
      score: top.score,
      detail: top.detail,
      candidateCount: searched.candidates.length,
      explored: searched.explored,
    };
  }

  async function findGlobalBestAllocation(cards, works, onProgress = null) {
    const unlockedWorks = getOrderedUnlockedWorks(works);
    const currentDeckByWork = Object.fromEntries(unlockedWorks.map(workName => [workName, getCardsCurrentlyInWork(workName)]));
    const byWork = Object.fromEntries(unlockedWorks.map(workName => [workName, {
      workName,
      deck: [],
      score: 0,
      detail: { total: 0, byCard: {} },
      key: '',
      exploredAt: 0,
    }]));
    const searchedByWork = [];
    let totalScore = 0;
    let nodes = 0;
    let remainingCards = [...cards];

    for (let index = 0; index < unlockedWorks.length; index++) {
      const workName = unlockedWorks[index];
      onProgress?.(`全体割当探索: ${workName} を探索中 (${index + 1}/${unlockedWorks.length})`);
      const searched = await searchTopDeckOptions(remainingCards, workName, CONFIG.topDeckOptionsPerWork, (message) => {
        onProgress?.(message);
      }, {
        seedDeck: currentDeckByWork[workName] || [],
      });
      searchedByWork.push(searched);

      const selected = findBestNonEmptyOption(searched.options);
      if (!selected) {
        throw new Error(`${workName} に割り当てられる非空デッキが見つかりませんでした`);
      }

      byWork[workName] = selected;
      totalScore += selected.score || 0;
      nodes += searched.explored || 0;
      remainingCards = removeSelectedCards(remainingCards, selected.deck);
    }

    return {
      totalScore,
      byWork,
      nodes,
      searchedByWork,
    };
  }

  function getOrderedUnlockedWorks(works) {
    const unlocked = new Set(works.filter(w => w.unlocked).map(w => w.name));
    return GLOBAL_WORK_PRIORITY.filter(workName => unlocked.has(workName));
  }

  function findBestNonEmptyOption(options) {
    return (options || []).find(option => option.deck?.length > 0) || null;
  }

  function calculateCurrentGlobalPower(works = state.works) {
    let totalScore = 0;
    const unlockedWorks = getOrderedUnlockedWorks(works);

    for (const workName of unlockedWorks) {
      const deck = getCardsCurrentlyInWork(workName);
      if (!deck.length) continue;
      const detail = evaluateDeck(deck, WORK_RULES[workName]);
      totalScore += detail.total || 0;
    }

    return totalScore;
  }

  // =========================
  // 実行
  // =========================

  async function runSingleWork(workName) {
    if (!state.cards.length) reloadAll();

    const cardsForWork = [
      ...state.cards,
      ...getCardsCurrentlyInWork(workName),
    ];

    setStatus(`${workName}: 最適化を計算中...`);
    const res = await findBestSingleWork(cardsForWork, workName, (progress) => {
      if (typeof progress === 'string') {
        setStatus(progress);
        return;
      }

      setStatus(progress.text || `${workName}: 最適化を計算中...`);
      if (progress.bestOption?.deck?.length) {
        setResultHtml(renderLiveSearchPreview(workName, progress.bestOption, progress));
      }
    });
    state.singleResults[workName] = res;

    setResultHtml(renderSingleWorkResult(workName, res));
    setStatus(`${workName}: 最適化が完了しました`);
  }

  async function runGlobalOptimization() {
    reloadAll();

    const allCards = [
      ...state.cards,
      ...WORK_ORDER.flatMap(workName => getCardsCurrentlyInWork(workName)),
    ];

    setStatus('全ワーク最適化: 候補デッキの探索を開始します...');
    try {
      const currentTotalScore = calculateCurrentGlobalPower(state.works);
      const plan = await findGlobalBestAllocation(allCards, state.works, (progress) => {
        if (typeof progress === 'string') {
          setStatus(progress);
          return;
        }

        setStatus(progress.text || '全ワーク最適化: 候補デッキを探索中...');
        if (progress.bestOption?.deck?.length) {
          setResultHtml(renderLiveSearchPreview(progress.workName, progress.bestOption, {
            ...progress,
            mode: 'global',
          }));
        }
      });

      if (plan.totalScore < currentTotalScore) {
        setStatus(`全ワーク最適化を中止しました。現在の累計Power ${formatNum(currentTotalScore)} を下回るため、候補 ${formatNum(plan.totalScore)} は不採用です`);
        alert(`全ワーク最適化を中止しました\n現在の累計Power ${formatNum(currentTotalScore)} を下回る候補だったため適用しません`);
        return;
      }

      state.globalPlan = plan;
      setResultHtml(renderGlobalPlan(state.globalPlan));
      setStatus(`全ワーク最適化が完了しました。合計推定Power ${formatNum(plan.totalScore)} / 探索 ${formatNum(plan.nodes)} ノード`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`全ワーク最適化に失敗しました: ${message}`);
      alert(`全ワーク最適化に失敗しました\n${message}`);
    }
  }

  function buildMacroGlobalPlan(byWork, unlockedWorks) {
    const normalizedByWork = {};
    let totalScore = 0;

    for (const workName of unlockedWorks) {
      const item = byWork[workName] || {
        workName,
        deck: [],
        score: 0,
        detail: { total: 0, byCard: {} },
        candidateCount: 0,
        explored: 0,
      };

      normalizedByWork[workName] = item;
      totalScore += item.score || 0;
    }

    const searchedByWork = unlockedWorks.map(workName => {
      const item = normalizedByWork[workName];
      return {
        workName,
        options: item.deck?.length ? [item] : [],
        explored: item.explored || 0,
      };
    });

    return {
      totalScore,
      byWork: normalizedByWork,
      nodes: searchedByWork.reduce((sum, item) => sum + (item.explored || 0), 0),
      searchedByWork,
    };
  }

  function removeSelectedCards(pool, selectedDeck) {
    const selectedIds = new Set(selectedDeck.map(card => card.id));
    return pool.filter(card => !selectedIds.has(card.id));
  }

  function renderSingleWorkResult(workName, res) {
    const freshDetail = getFreshDeckDetail(workName, res.deck, res.detail);
    return `
      <div class="cpcc-card">
        <div class="cpcc-title">${escapeHtml(workName)} 単体最適</div>
        <div class="cpcc-score">推定合計Power: ${formatNum(res.score)}</div>
        <div class="cpcc-sub">候補数: ${res.candidateCount} / 探索数: ${formatNum(res.explored)}</div>
        <div class="cpcc-btns">
          <button class="green" data-cpcc-action="set-work" data-work="${escapeHtml(workName)}">このデッキを自動セット</button>
          <button class="green" data-cpcc-action="highlight-work" data-work="${escapeHtml(workName)}">このデッキをハイライト</button>
        </div>
      </div>
      ${renderDeckCards(res.deck || [], freshDetail)}
    `;
  }

  function renderGlobalPlan(plan) {
    const rows = [];
    const shownWorks = WORK_ORDER.filter(name => state.works.find(w => w.name === name && w.unlocked));

    for (const workName of shownWorks) {
      const item = plan.byWork[workName] || {
        deck: [],
        score: 0,
        detail: { total: 0, byCard: {} },
      };
      const freshDetail = getFreshDeckDetail(workName, item.deck, item.detail);

      rows.push(`
        <div class="cpcc-card">
          <div class="cpcc-title">${escapeHtml(workName)}</div>
          <div class="cpcc-score">推定Power: ${formatNum(item.score || 0)}</div>
        </div>
        ${renderDeckCards(item.deck || [], freshDetail)}
      `);
    }

    const searchedSummary = plan.searchedByWork.map(x => {
      return `<div>${escapeHtml(x.workName)}: 候補デッキ ${x.options.length} / 探索 ${formatNum(x.explored)}</div>`;
    }).join('');

    return `
      <div class="cpcc-card">
        <div class="cpcc-title">全ワーク最適化結果</div>
        <div class="cpcc-score">合計推定Power: ${formatNum(plan.totalScore)}</div>
        <div class="cpcc-sub">探索ノード: ${formatNum(plan.nodes)}</div>
        <div class="cpcc-sub">${searchedSummary}</div>
        <div class="cpcc-btns">
          <button class="green" data-cpcc-action="set-global">この全プランを自動セット</button>
        </div>
        <div class="cpcc-sub cpcc-warn">既に入っているカードがある場合は、先にそのワークを空にする処理を試みます</div>
      </div>
      ${rows.join('')}
    `;
  }

  function renderDeckCards(deck, detail) {
    if (!deck?.length) {
      return `<div class="cpcc-card"><span class="cpcc-muted">カードなし</span></div>`;
    }

    return deck.map(c => {
      const d = detail?.byCard?.[c.id] || { bonusPercent: 0, basePower: c.power, bonusPower: 0, afterClubBonus: c.power, fieldPower: 0, finalPower: c.power, fieldLabel: 'なし' };
      const bonusPowerText = d.bonusPower > 0 ? `(+${formatNum(d.bonusPower)})` : (d.bonusPower < 0 ? `(${formatNum(d.bonusPower)})` : '(0)');
      const fieldPowerText = d.fieldPower > 0 ? `(+${formatNum(d.fieldPower)})` : (d.fieldPower < 0 ? `(${formatNum(d.fieldPower)})` : '(0)');

      return `
      <div
        class="cpcc-card cpcc-result-card"
        data-cpcc-card-id="${escapeHtml(c.id)}"
        data-cpcc-card-sig="${escapeHtml(getCardSignatureKey(c))}"
        data-cpcc-card-name="${escapeHtml(c.name)}"
        data-cpcc-card-power="${escapeHtml(String(c.power))}"
        data-cpcc-card-club="${escapeHtml(c.club)}"
        data-cpcc-card-rarity="${escapeHtml(c.rarity)}"
        title="クリックでカード位置へスクロール"
      >
        <div class="cpcc-title">${escapeHtml(c.name)} <span class="cpcc-sub">[${escapeHtml(c.rarity)}]</span></div>
        <div>部活: ${escapeHtml(c.club)} / 基礎Power: ${c.power}</div>
        <div>基礎Power: ${formatNum(d.basePower)} / 部活補正: ${d.bonusPercent > 0 ? '+' : ''}${d.bonusPercent}% ${bonusPowerText}</div>
        <div>場効果: ${escapeHtml(d.fieldLabel || 'なし')} ${fieldPowerText} / 場効果後: ${formatNum(d.finalPower)}</div>
      </div>
    `;
    }).join('');
  }

  function getFreshDeckDetail(workName, deck, fallbackDetail = null) {
    if (!deck?.length) return fallbackDetail || { byCard: {} };
    const rule = WORK_RULES[workName];
    if (!rule) return fallbackDetail || { byCard: {} };
    return evaluateDeck(deck, rule);
  }

  // =========================
  // 自動セット
  // =========================

  async function autoSetGlobalPlan(byWork) {
    setStatus('全プラン自動セットを開始します...');

    const targetWorks = getOrderedUnlockedWorks(state.works);

    for (const workName of targetWorks) {
      await clearWorkDeck(workName);
    }

    syncStateSilently();

    for (const workName of targetWorks) {
      const item = byWork[workName];
      if (!item?.deck?.length) continue;
      await autoSetWorkDeck(workName, item.deck);
    }

    setStatus('全プランの自動セットが完了しました');
  }

  async function autoSetWorkDeck(workName, deck, opts = {}) {
    const work = state.works.find(w => w.name === workName) || { root: findWorkRoot(workName), unlocked: true };
    if (!work.root) {
      alert(`ワークが見つかりません: ${workName}`);
      return;
    }

    const targetDeck = deck || [];
    const currentEntries = getCurrentWorkCardEntries(workName);
    const diff = diffWorkDeck(currentEntries, targetDeck);
    const entriesToRemove = opts.skipRemoval ? [] : diff.toRemove;

    if (!entriesToRemove.length && !diff.toAdd.length) {
      setStatus(`${workName}: 差分がないため再セットを省略しました`);
      return;
    }

    setStatus(`${workName}: ${entriesToRemove.length} 枚解除 / ${diff.toAdd.length} 枚設定します`);
    await activateWorkBase(workName);

    await removeWorkEntries(workName, entriesToRemove);

    for (const card of diff.toAdd) {
      const currentRoot = findWorkRoot(workName);
      const countBefore = currentRoot ? parseCurrentCount(currentRoot) : 0;
      if (countBefore >= 5) {
        setStatus(`${workName}: 既に5枚入っています`);
        break;
      }

      await activateWorkBase(workName);

      const cardRoot = findOwnedCardRootForSelectionEx(card, { excludeInDeck: true });
      if (!cardRoot) {
        setStatus(`${workName}: カードが見つかりません ${card.name}`);
        continue;
      }

      const target = findClickableCardTarget(cardRoot);
      if (!target) {
        setStatus(`${workName}: クリック対象が見つかりません ${card.name}`);
        continue;
      }

      simulateClick(target);
      highlightElement(target, 'red');
      await sleep(CONFIG.autoStepDelay);
      const changed = await waitForWorkCountAtLeast(workName, countBefore + 1, 2500);
      if (!changed) {
        await sleep(CONFIG.autoClickDelayLong);
      }
    }

    setStatus(`${workName}: 自動セット完了`);
  }

  async function removeWorkEntries(workName, entries) {
    for (const entry of entries) {
      await activateWorkBase(workName);
      const rootNow = findWorkRoot(workName);
      const countBefore = rootNow ? parseCurrentCount(rootNow) : 0;
      if (countBefore <= 0) break;
      if (!entry.root?.isConnected) continue;

      simulateClick(entry.root);
      highlightElement(entry.root, 'orange');
      await sleep(CONFIG.autoStepDelay);
      const changed = await waitForWorkCountLessThan(workName, countBefore, 4000);
      if (!changed) {
        await sleep(CONFIG.autoClickDelayLong);
      }
    }
  }

  function highlightElement(el, color = 'red') {
    if (!el) return;
    const old = el.style.outline;
    el.style.outline = `3px solid ${color}`;
    setTimeout(() => {
      el.style.outline = old;
    }, 1200);
  }

  async function clearWorkDeck(workName) {
    const workRoot = findWorkRoot(workName);
    if (!workRoot) return;

    const currentCount = parseCurrentCount(workRoot);
    if (currentCount <= 0) return;

    setStatus(`${workName}: 既存カードを外しています...`);
    await activateWorkBase(workName);

    for (let loop = 0; loop < 8; loop++) {
      await activateWorkBase(workName);
      const rootNow = findWorkRoot(workName);
      const countBefore = rootNow ? parseCurrentCount(rootNow) : 0;
      const cardTargets = rootNow ? findFilledWorkCardRoots(rootNow) : [];
      if (!cardTargets.length) break;

      const target = cardTargets[cardTargets.length - 1];
      if (target) {
        simulateClick(target);
        highlightElement(target, 'orange');
        await sleep(CONFIG.autoStepDelay);
        const changed = await waitForWorkCountLessThan(workName, countBefore, 4000);
        if (!changed) {
          await sleep(CONFIG.autoClickDelayLong);
        }
      }

      const countNow = parseCurrentCount(findWorkRoot(workName));
      if (countNow === 0) break;
    }

    await waitForWorkCountAtMost(workName, 0, 4000);
  }

  async function activateWorkBase(workName) {
    const workRoot = findWorkRoot(workName);
    if (!workRoot) return false;

    if (workRoot.classList.contains('active-base')) return true;

    const header = workRoot.querySelector('.base-header') || workRoot;
    simulateClick(header);
    await waitUntil(() => workRoot.classList.contains('active-base'), 800);
    return workRoot.classList.contains('active-base');
  }

  async function waitForWorkCount(workName, expectedCount, timeoutMs = 2000) {
    return waitUntil(() => {
      const root = findWorkRoot(workName);
      return !!root && parseCurrentCount(root) === expectedCount;
    }, timeoutMs);
  }

  async function waitForWorkCountAtMost(workName, maxCount, timeoutMs = 2000) {
    return waitUntil(() => {
      const root = findWorkRoot(workName);
      return !!root && parseCurrentCount(root) <= maxCount;
    }, timeoutMs);
  }

  async function waitForWorkCountAtLeast(workName, minCount, timeoutMs = 2000) {
    return waitUntil(() => {
      const root = findWorkRoot(workName);
      return !!root && parseCurrentCount(root) >= minCount;
    }, timeoutMs);
  }

  async function waitForWorkCountLessThan(workName, previousCount, timeoutMs = 2000) {
    return waitUntil(() => {
      const root = findWorkRoot(workName);
      return !!root && parseCurrentCount(root) < previousCount;
    }, timeoutMs);
  }

  async function waitUntil(checkFn, timeoutMs = 1500, intervalMs = 80) {
    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
      if (checkFn()) return true;
      await sleep(intervalMs);
    }
    return checkFn();
  }

  function findNextEmptySlot(workRoot) {
    const candidates = [...workRoot.querySelectorAll('*')];

    // 「空き」と出ているカード枠候補を優先
    const slotCandidates = candidates.filter(el => {
      const text = normalizeSpace(el.innerText || el.textContent || '');
      if (!text.includes('空き')) return false;

      const rect = safeRect(el);
      if (rect.width < 80 || rect.height < 80) return false;

      return true;
    });

    if (!slotCandidates.length) return null;

    // その中で一番カード枠っぽい大きさのものを返す
    slotCandidates.sort((a, b) => {
      const ra = safeRect(a);
      const rb = safeRect(b);
      return (rb.width * rb.height) - (ra.width * ra.height);
    });

    return slotCandidates[0];
  }

  function findFilledWorkCardTargets(workRoot) {
    const imgs = [...workRoot.querySelectorAll('img[alt]')].filter(img => {
      const alt = (img.getAttribute('alt') || '').trim();
      const src = (img.getAttribute('src') || '').trim();
      if (!alt) return false;
      if (src.includes('icon_')) return false;
      if (alt === 'からぱり☆カードコレクション!') return false;
      if (['N', 'R', 'SR', 'SSR'].includes(alt)) return false;
      return true;
    });

    return imgs;
  }

  function findFilledWorkCardRoots(workRoot) {
    const cardsContainer = workRoot.querySelector('.base-cards, .card-container.base-cards');
    if (!cardsContainer) return [];

    return [...cardsContainer.querySelectorAll('.card')]
      .filter(card => !card.classList.contains('card-empty-slot') && !!findMainCardImage(card));
  }

  function getCurrentWorkCardEntries(workName) {
    const root = findWorkRoot(workName);
    if (!root) return [];

    return findFilledWorkCardRoots(root)
      .map((cardRoot, index) => {
        const card = parseCardFromRoot(cardRoot, `current-${workName}-${index}`);
        if (!card) return null;
        return {
          root: cardRoot,
          card,
          key: getCardSignatureKey(card),
        };
      })
      .filter(Boolean);
  }

  function diffWorkDeck(currentEntries, targetDeck) {
    const targetCounts = new Map();
    for (const card of targetDeck) {
      const key = getCardSignatureKey(card);
      targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
    }

    const keptCounts = new Map();
    const toRemove = [];

    for (const entry of currentEntries) {
      const keepCount = keptCounts.get(entry.key) || 0;
      const targetCount = targetCounts.get(entry.key) || 0;

      if (keepCount < targetCount) {
        keptCounts.set(entry.key, keepCount + 1);
      } else {
        toRemove.push(entry);
      }
    }

    const currentKeptCounts = new Map();
    for (const entry of currentEntries) {
      const currentCount = currentKeptCounts.get(entry.key) || 0;
      const targetCount = targetCounts.get(entry.key) || 0;
      if (currentCount < targetCount) {
        currentKeptCounts.set(entry.key, currentCount + 1);
      }
    }

    const addCounts = new Map();
    for (const [key, targetCount] of targetCounts.entries()) {
      const currentCount = currentKeptCounts.get(key) || 0;
      if (targetCount > currentCount) {
        addCounts.set(key, targetCount - currentCount);
      }
    }

    const toAdd = [];
    for (const card of targetDeck) {
      const key = getCardSignatureKey(card);
      const remaining = addCounts.get(key) || 0;
      if (remaining <= 0) continue;
      toAdd.push(card);
      addCounts.set(key, remaining - 1);
    }

    return { toRemove, toAdd };
  }

  function findOwnedCardRootForSelection(card) {
    return findOwnedCardRootForSelectionEx(card);
  }

  function findCardRootForJump(card) {
    return findCardRootForHighlight(card);
  }

  function findCardRootForHighlight(card, opts = {}) {
    const excludeRoots = opts.excludeRoots || new Set();
    const preferredWorkName = opts.preferredWorkName || '';
    const targetSignature = getCardSignatureKey(card);
    const searchRoots = [];
    const pushRoots = (roots) => {
      for (const root of roots) {
        if (!root || excludeRoots.has(root)) continue;
        searchRoots.push(root);
      }
    };

    if (preferredWorkName) {
      const preferredRoot = findWorkRoot(preferredWorkName);
      if (preferredRoot) pushRoots(findFilledWorkCardRoots(preferredRoot));
    }

    for (const workName of WORK_ORDER) {
      if (workName === preferredWorkName) continue;
      const workRoot = findWorkRoot(workName);
      if (workRoot) pushRoots(findFilledWorkCardRoots(workRoot));
    }

    pushRoots(findOwnedCardRoots());

    return searchRoots.find(root => getCardRootSignatureKey(root) === targetSignature) || null;
  }

  function findOwnedCardRootForSelectionEx(card, opts = {}) {
    const excludeRoots = opts.excludeRoots || new Set();
    const excludeInDeck = !!opts.excludeInDeck;
    const targetSignature = getCardSignatureKey(card);
    const rememberedRoots = [
      card?.root,
      state.cards.find(c => c.id === card.id)?.root,
    ].filter(Boolean);

    for (const root of rememberedRoots) {
      if (excludeRoots.has(root)) continue;
      if (excludeInDeck && root.classList.contains('in-deck')) continue;
      if (getCardRootSignatureKey(root) === targetSignature) return root;
    }

    const roots = findOwnedCardRoots().filter(root => {
      if (excludeRoots.has(root)) return false;
      if (excludeInDeck && root.classList.contains('in-deck')) return false;
      return true;
    });

    return roots.find(root => getCardRootSignatureKey(root) === targetSignature) || null;
  }

  function isMatchingCardRoot(root, card) {
    if (!root?.isConnected) return false;
    return getCardRootSignatureKey(root) === getCardSignatureKey(card);
  }

  function parseCardSignature(root) {
    const text = normalizeSpace(root.innerText || root.textContent || '');
    const img = findMainCardImage(root);
    const nameEl = root.querySelector('.card-name');
    const powerEl = root.querySelector('.base-pwr');
    const name = normalizeSpace(nameEl?.textContent || '') || (img?.getAttribute('alt') || '').trim();
    const powerText = normalizeSpace(powerEl?.textContent || '');
    const powerMatch = powerText.match(/(\d+)/) || text.match(/Power\s*(\d+)/i);
    const rarity = parseRarity(root) || 'N';
    const club = parseClubFromRoot(root, text);

    return {
      name,
      power: powerMatch ? Number(powerMatch[1]) : null,
      club,
      rarity,
    };
  }

  function findClickableCardTarget(cardRoot) {
    if (!cardRoot) return null;

    // 画像単体ではなくカード全体を押したほうが安定
    let current = cardRoot;
    while (current && current !== document.body) {
      const text = normalizeSpace(current.innerText || current.textContent || '');
      const rect = safeRect(current);

      if (/Power\s*\d+/i.test(text) && rect.width >= 120 && rect.height >= 180) {
        return current;
      }

      current = current.parentElement;
    }

    return cardRoot;
  }

  function simulateClick(el) {
    if (!el) return false;

    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch { }

    if (typeof el.click === 'function') {
      el.click();
      return true;
    }

    const rect = safeRect(el);
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
    });
    el.dispatchEvent(ev);

    return true;
  }

  // =========================
  // utility
  // =========================

  function sumPositiveEffects(card) {
    return card.effects.reduce((s, e) => s + Math.max(0, e.value), 0);
  }

  function sumEffectForTargets(card, targetClubs) {
    return card.effects.reduce((s, e) => {
      if (!targetClubs.has(e.club)) return s;
      return s + e.value;
    }, 0);
  }

  function createOptimizationTicker() {
    let count = 0;
    return {
      async tick() {
        count++;
        if (count % CONFIG.optimizeYieldEvery === 0) {
          await sleep(0);
        }
      },
    };
  }

  function createSynergySearchProgress(workName, onProgress) {
    const startedAt = Date.now();
    let lastEmit = 0;

    return {
      report({ processedGroups = 0, totalGroups = 0, explored = 0, bestScore = 0, bestOption = null }) {
        if (!onProgress) return;
        const now = Date.now();
        if ((now - lastEmit) < 150) return;
        lastEmit = now;

        const ratio = totalGroups > 0 ? Math.max(0, Math.min(1, processedGroups / totalGroups)) : 0;
        const elapsed = now - startedAt;
        const etaMs = ratio > 0 ? Math.max(0, (elapsed / ratio) - elapsed) : null;
        const pct = Math.floor(ratio * 100);
        const eta = etaMs == null ? '残り時間 推定中' : `残り約 ${formatEta(etaMs)}`;
        onProgress({
          text: `${workName}: シナジー探索 ${formatNum(processedGroups)} / ${formatNum(totalGroups)} 軸 (${pct}%) / 試行 ${formatNum(explored)} / 暫定 ${formatNum(bestScore)} / ${eta}`,
          workName,
          processedGroups,
          totalGroups,
          explored,
          bestScore,
          bestOption,
        });
      },
    };
  }

  function formatEta(ms) {
    const sec = Math.max(1, Math.round(ms / 1000));
    if (sec < 60) return `${sec}秒`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    if (min < 60) return rem ? `${min}分${rem}秒` : `${min}分`;
    const hour = Math.floor(min / 60);
    const minRem = min % 60;
    return minRem ? `${hour}時間${minRem}分` : `${hour}時間`;
  }

  function normalizeSpace(str) {
    return String(str || '').replace(/\s+/g, ' ').trim();
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatNum(v) {
    return Number(v || 0).toLocaleString();
  }

  function getStorageArea() {
    return globalThis.chrome?.storage?.local || null;
  }

  async function storageGet(keys) {
    const area = getStorageArea();
    if (!area) return {};
    return await new Promise(resolve => area.get(keys, resolve));
  }

  async function storageSet(items) {
    const area = getStorageArea();
    if (!area) return;
    await new Promise(resolve => area.set(items, resolve));
  }

  async function storageRemove(keys) {
    const area = getStorageArea();
    if (!area) return;
    await new Promise(resolve => area.remove(keys, resolve));
  }

  async function getOrCreateOptionScan(cards) {
    const cacheKey = buildOptionScanCacheKey(cards);
    const stored = await storageGet(cacheKey);
    const payload = stored?.[cacheKey];

    if (payload?.version === CONFIG.storageCacheVersion) {
      const restored = restoreOptionScan(payload, cards);
      if (restored) return restored;
    }

    const scan = computeOptionScan(cards);
    await storageSet({
      [cacheKey]: {
        version: CONFIG.storageCacheVersion,
        savedAt: Date.now(),
        entries: serializeOptionScan(scan, cards),
      },
    });
    return scan;
  }

  function computeOptionScan(cards) {
    const byId = new Map();
    for (const card of cards) {
      byId.set(card.id, computeCardOptionMetrics(card));
    }
    return { byId };
  }

  function serializeOptionScan(scan, cards) {
    return cards.map(card => ({
      sig: getCardSignatureKey(card),
      metrics: serializeOptionMetrics(scan.byId.get(card.id) || computeCardOptionMetrics(card)),
    }));
  }

  function serializeOptionMetrics(metrics) {
    return {
      ...metrics,
      buffByClub: [...(metrics.buffByClub || new Map()).entries()],
      slotByClub: [...(metrics.slotByClub || new Map()).entries()],
    };
  }

  function restoreOptionScan(payload, cards) {
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    if (!entries.length) return null;

    const bySignature = new Map();
    for (const entry of entries) {
      if (!entry?.sig || !entry?.metrics) continue;
      bySignature.set(entry.sig, entry.metrics);
    }

    const byId = new Map();
    for (const card of cards) {
      const metrics = bySignature.get(getCardSignatureKey(card));
      if (!metrics) continue;
      byId.set(card.id, {
        ...metrics,
        buffByClub: new Map(metrics.buffByClub || []),
        slotByClub: new Map(metrics.slotByClub || []),
      });
    }

    if (byId.size !== cards.length) return null;
    return { byId };
  }

  async function loadSearchCache(cacheKey, cards, workName) {
    const stored = await storageGet(cacheKey);
    const payload = stored?.[cacheKey];
    if (!payload || payload.version !== CONFIG.storageCacheVersion || payload.workName !== workName) {
      return null;
    }

    const options = restoreCachedOptions(payload.options, cards, workName);
    if (!options.length) return null;

    return {
      workName,
      rule: WORK_RULES[workName],
      candidates: [],
      options,
      explored: payload.explored || 0,
      fromCache: true,
    };
  }

  async function saveSearchCache(cacheKey, cards, workName, searched) {
    const payload = {
      version: CONFIG.storageCacheVersion,
      workName,
      savedAt: Date.now(),
      explored: searched.explored || 0,
      options: serializeCachedOptions(searched.options || [], cards),
    };

    await storageSet({ [cacheKey]: payload });
    await touchCacheIndex(cacheKey, payload.savedAt);
  }

  function serializeCachedOptions(options, cards) {
    return options.map(option => ({
      key: option.key || '',
      exploredAt: option.exploredAt || 0,
      deckRefs: serializeDeckRefs(option.deck || [], cards),
    }));
  }

  function restoreCachedOptions(options, cards, workName) {
    const restored = [];
    for (const option of options || []) {
      const deck = restoreDeckRefs(option.deckRefs || [], cards);
      if ((option.deckRefs || []).length && deck.length !== option.deckRefs.length) continue;
      const detail = evaluateDeck(deck, WORK_RULES[workName]);
      restored.push({
        workName,
        deck,
        score: deck.length ? detail.total : 0,
        detail,
        key: option.key || deck.map(c => c.id).sort().join('|'),
        exploredAt: option.exploredAt || 0,
      });
    }
    return restored;
  }

  function serializeDeckRefs(deck, cards) {
    const indexById = new Map(cards.map((card, index) => [card.id, index]));
    return deck.map(card => ({
      id: card.id,
      index: indexById.get(card.id) ?? -1,
      sig: getCardSignatureKey(card),
    }));
  }

  function restoreDeckRefs(deckRefs, cards) {
    const usedIds = new Set();
    const bySignature = new Map();

    for (const card of cards) {
      const sig = getCardSignatureKey(card);
      const arr = bySignature.get(sig) || [];
      arr.push(card);
      bySignature.set(sig, arr);
    }

    return deckRefs.map(ref => {
      const byId = cards[ref.index];
      if (byId && byId.id === ref.id && !usedIds.has(byId.id)) {
        usedIds.add(byId.id);
        return byId;
      }

      const arr = bySignature.get(ref.sig) || [];
      const fallback = arr.find(card => !usedIds.has(card.id));
      if (fallback) {
        usedIds.add(fallback.id);
        return fallback;
      }
      return null;
    }).filter(Boolean);
  }

  async function touchCacheIndex(cacheKey, savedAt) {
    const loaded = await storageGet(CACHE_INDEX_KEY);
    const index = Array.isArray(loaded?.[CACHE_INDEX_KEY]) ? loaded[CACHE_INDEX_KEY] : [];
    const filtered = index.filter(item => item?.key !== cacheKey);
    filtered.unshift({ key: cacheKey, savedAt });

    const trimmed = filtered.slice(0, CONFIG.storageCacheMaxEntries);
    const removed = filtered.slice(CONFIG.storageCacheMaxEntries).map(item => item.key);

    await storageSet({ [CACHE_INDEX_KEY]: trimmed });
    if (removed.length) {
      await storageRemove(removed);
    }
  }

  async function pruneInvalidCachedSearches() {
    const loaded = await storageGet(CACHE_INDEX_KEY);
    const index = Array.isArray(loaded?.[CACHE_INDEX_KEY]) ? loaded[CACHE_INDEX_KEY] : [];
    if (!index.length) return;

    const signatureCounts = collectAvailableCardSignatureCounts();
    const allKeys = index.map(item => item.key).filter(Boolean);
    const stored = await storageGet(allKeys);
    const validIndex = [];
    const invalidKeys = [];

    for (const item of index) {
      const cacheKey = item?.key;
      const payload = cacheKey ? stored?.[cacheKey] : null;
      if (!cacheKey || !payload) continue;

      if (isCachedPayloadValid(payload, signatureCounts)) {
        validIndex.push(item);
      } else {
        invalidKeys.push(cacheKey);
      }
    }

    if (invalidKeys.length) {
      await storageRemove(invalidKeys);
      await storageSet({ [CACHE_INDEX_KEY]: validIndex });
    }
  }

  function isCachedPayloadValid(payload, availableSignatureCounts) {
    const options = payload?.options || [];
    for (const option of options) {
      const refs = option?.deckRefs || [];
      const required = new Map();
      for (const ref of refs) {
        if (!ref?.sig) continue;
        required.set(ref.sig, (required.get(ref.sig) || 0) + 1);
      }
      for (const [sig, count] of required.entries()) {
        if ((availableSignatureCounts.get(sig) || 0) < count) {
          return false;
        }
      }
    }
    return true;
  }

  function collectAvailableCardSignatureCounts() {
    const counts = new Map();
    const seenRoots = new Set();
    const pushRoot = (root) => {
      if (!root || seenRoots.has(root)) return;
      seenRoots.add(root);
      const sig = getCardRootSignatureKey(root);
      if (!sig) return;
      counts.set(sig, (counts.get(sig) || 0) + 1);
    };

    findOwnedCardRoots().forEach(pushRoot);
    for (const workName of WORK_ORDER) {
      const workRoot = findWorkRoot(workName);
      if (!workRoot) continue;
      findFilledWorkCardRoots(workRoot).forEach(pushRoot);
    }

    return counts;
  }

  function buildSearchCacheKey(cards, workName, seedDeck = []) {
    const rule = WORK_RULES[workName];
    const parts = buildCardsFingerprintParts(cards);
    const seedParts = seedDeck.map(card => getCardSignatureKey(card)).sort();

    const base = JSON.stringify({
      version: CONFIG.storageCacheVersion,
      workName,
      rule,
      config: {
        topDeckOptionsPerWork: CONFIG.topDeckOptionsPerWork,
        prefilterOverallKeep: CONFIG.prefilterOverallKeep,
        prefilterPerClubKeep: CONFIG.prefilterPerClubKeep,
        candidateOverallKeep: CONFIG.candidateOverallKeep,
        candidatePerClubKeep: CONFIG.candidatePerClubKeep,
        synergyAnchorKeep: CONFIG.synergyAnchorKeep,
        synergyPairAnchorKeep: CONFIG.synergyPairAnchorKeep,
        synergyPoolKeep: CONFIG.synergyPoolKeep,
        synergyGeneralKeep: CONFIG.synergyGeneralKeep,
        currentDeckSwapPoolKeep: CONFIG.currentDeckSwapPoolKeep,
        currentDeckPairSwapKeep: CONFIG.currentDeckPairSwapKeep,
      },
      seedDeck: seedParts,
      cards: parts,
    });
    return `${CACHE_KEY_PREFIX}${hashString(base)}`;
  }

  function buildOptionScanCacheKey(cards) {
    const base = JSON.stringify({
      version: CONFIG.storageCacheVersion,
      type: 'option-scan',
      cards: buildCardsFingerprintParts(cards),
    });
    return `${OPTION_SCAN_CACHE_KEY_PREFIX}${hashString(base)}`;
  }

  function buildCardsFingerprintParts(cards) {
    return cards
      .map(card => [
        card.name,
        card.power,
        card.club,
        card.rarity,
        card.effects.map(eff => `${eff.club}:${eff.value}`).sort().join(','),
      ].join('/'))
      .sort();
  }

  function hashString(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function safeRect(el) {
    try {
      return el.getBoundingClientRect();
    } catch {
      return { width: 0, height: 0 };
    }
  }

  function clearAllHighlights() {
    document.querySelectorAll('.cpcc-highlight-card').forEach(el => {
      el.classList.remove('cpcc-highlight-card');
      el.removeAttribute('data-cpcc-work');
      el.querySelectorAll('.cpcc-highlight-badge').forEach(badge => badge.remove());
    });
  }

  function highlightDeck(deck, workName, usedRoots = new Set()) {
    for (const card of deck) {
      const root = findCardRootForHighlight(card, {
        excludeRoots: usedRoots,
        preferredWorkName: workName,
      });
      if (!root) {
        continue;
      }

      usedRoots.add(root);
      root.classList.add('cpcc-highlight-card');
      root.setAttribute('data-cpcc-work', workName);
      ensureHighlightBadge(root, workName);
    }
  }

  function ensureHighlightBadge(root, workName) {
    if (!root) return;
    let badge = root.querySelector(':scope > .cpcc-highlight-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'cpcc-highlight-badge';
      root.appendChild(badge);
    }
    badge.textContent = workName;
  }

  // =========================
  // 起動
  // =========================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
