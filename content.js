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
  };

  // =========================
  // 初期化
  // =========================

  function boot() {
    if (document.getElementById('cpcc-optimizer-root')) return;
    createPanel();
    reloadAll();
  }

  function reloadAll() {
    const allOwnedRoots = findOwnedCardRoots();
    state.cards = parseOwnedCardsRobust();
    state.works = detectWorks();
    setStatus(`総所持 ${allOwnedRoots.length} 枚 / 未使用 ${state.cards.length} 枚 / ワーク ${state.works.filter(w => w.unlocked).length} 件を読み込みました`);
    setResultHtml(renderLoadedPreview());
    console.log('[CPCC] cards', state.cards);
    console.log('[CPCC] works', state.works);
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

    if (!document.getElementById('cpcc-optimizer-style')) {
      const style = document.createElement('style');
      style.id = 'cpcc-optimizer-style';
      style.textContent = `
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

        .cpcc-highlight-card[data-cpcc-work]::after{
          content: attr(data-cpcc-work);
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
    root.querySelector('#cpcc-close').addEventListener('click', () => root.remove());

    root.querySelectorAll('[data-work]').forEach(btn => {
      btn.addEventListener('click', () => runSingleWork(btn.dataset.work));
    });
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
        const plan = state.singleResults?.[workName] || state.globalPlan?.byWork?.[workName];
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
        const plan = state.globalPlan?.byWork?.[workName] || state.singleResults?.[workName];
        if (!plan?.deck?.length) {
          alert('ハイライト対象のデッキがありません');
          return;
        }

        clearAllHighlights();
        highlightDeck(plan.deck, workName);
        setStatus(`${workName}: ${plan.deck.length} 枚をハイライトしました`);
      };
    });

    document.querySelectorAll('[data-cpcc-action="highlight-global"]').forEach(btn => {
      btn.onclick = () => {
        if (!state.globalPlan?.byWork) {
          alert('先に全ワーク最適化を実行してください');
          return;
        }

        clearAllHighlights();

        for (const [workName, plan] of Object.entries(state.globalPlan.byWork)) {
          if (!plan?.deck?.length) continue;
          highlightDeck(plan.deck, workName);
        }

        setStatus('全プランのカードをハイライトしました');
      };
    });

    document.querySelectorAll('.cpcc-result-card').forEach(el => {
      el.onclick = () => {
        const cardId = el.dataset.cpccCardId;
        const cardName = el.dataset.cpccCardName;

        const card = state.cards.find(c => c.id === cardId) || state.cards.find(c => c.name === cardName);
        if (!card) return;

        jumpToOwnedCard(card, el);
      };
    });
  }

  function jumpToOwnedCard(card, resultEl = null) {
    const target = findOwnedCardRootForSelection(card);
    if (!target) {
      setStatus(`カード位置が見つかりません: ${card.name}`);
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

    setStatus(`カード位置へ移動: ${card.name}`);
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

  function getCardSignatureKey(card) {
    return [card.name, card.power, card.club, card.rarity].join('__');
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
        const info = parseCardSignature(cardRoot);
        if (!info?.name || info.power == null || !info.club) continue;

        const key = getCardSignatureKey(info);
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
    if (!rule) return card.power;

    if (rule.type === 'minPower') {
      return Math.max(card.power, rule.minPower);
    }

    if (rule.type === 'rarityMultiplier') {
      return rule.rarities.includes(card.rarity)
        ? card.power * rule.multiplier
        : card.power;
    }

    if (rule.type === 'clubMultiplier') {
      return rule.clubs.includes(card.club)
        ? card.power * rule.multiplier
        : card.power;
    }

    if (rule.type === 'onlyClub') {
      return rule.clubs.includes(card.club)
        ? card.power
        : 0;
    }

    return card.power;
  }

  function evaluateDeck(deck, rule) {
    const buffByClub = new Map();
    for (const card of deck) {
      for (const eff of card.effects) {
        buffByClub.set(eff.club, (buffByClub.get(eff.club) || 0) + eff.value);
      }
    }

    const byCard = {};
    let total = 0;

    for (const card of deck) {
      const baseAfterWork = applyWorkBase(card, rule);
      const clubBonus = buffByClub.get(card.club) || 0;
      const finalPower = roundPower(baseAfterWork * (1 + clubBonus / 100));

      byCard[card.id] = {
        bonusPercent: clubBonus,
        baseAfterWork,
        finalPower,
      };
      total += finalPower;
    }

    return { total, byCard };
  }

  function estimateCardValue(card, rule) {
    const baseScore = applyWorkBase(card, rule);
    let score = baseScore;
    let ownPositive = 0;
    let ownNegative = 0;
    let relevantPositive = 0;
    let relevantNegative = 0;
    let otherPositive = 0;
    let otherNegative = 0;

    const targetClubs = new Set(rule.clubs || []);

    for (const eff of card.effects) {
      if (eff.value >= 0) {
        if (eff.club === card.club) ownPositive += eff.value;
        else if (targetClubs.has(eff.club)) relevantPositive += eff.value;
        else otherPositive += eff.value;
      } else {
        if (eff.club === card.club) ownNegative += Math.abs(eff.value);
        else if (targetClubs.has(eff.club)) relevantNegative += Math.abs(eff.value);
        else otherNegative += Math.abs(eff.value);
      }
    }

    // 上級者向けの判断:
    // 自部活への加算が強いカードは、単純な素パワー以上に伸びやすい
    score += ownPositive * 9;
    score += relevantPositive * 5;
    score += otherPositive * 1.5;
    score -= ownNegative * 7;
    score -= relevantNegative * 4;
    score -= otherNegative * 1.2;

    if ((rule.type === 'clubMultiplier' || rule.type === 'onlyClub') && targetClubs.has(card.club)) {
      score += ownPositive * 4;
      score += baseScore * 0.35;
    }

    if (rule.type === 'rarityMultiplier' && rule.rarities?.includes(card.rarity)) {
      score += ownPositive * 2;
      score += relevantPositive * 1.5;
    }

    if (rule.type === 'minPower') {
      score += ownPositive * 2.5;
    }

    if (card.effects.length === 0) {
      score -= Math.max(80, baseScore * 0.35);
    } else if ((ownPositive + relevantPositive + otherPositive) === 0) {
      score -= Math.max(120, baseScore * 0.45);
    }

    if (ownPositive >= 100) {
      score += baseScore * (ownPositive / 100) * 0.45;
    }

    return score;
  }

  function buildCandidates(cards, rule) {
    return [...cards];
  }

  async function searchTopDeckOptions(cards, workName, maxKeep = CONFIG.topDeckOptionsPerWork) {
    const rule = WORK_RULES[workName];
    const candidates = buildCandidates(cards, rule)
      .sort((a, b) => estimateCardValue(b, rule) - estimateCardValue(a, rule));

    const bestOptions = [];
    let explored = 0;
    const ticker = createOptimizationTicker();
    const emptyOption = {
      workName,
      deck: [],
      score: 0,
      detail: { total: 0, byCard: {} },
      key: '',
      exploredAt: 0,
    };

    await dfs([], 0);

    const options = [emptyOption, ...bestOptions]
      .filter((option, index, arr) => arr.findIndex(x => x.key === option.key) === index)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxKeep);

    if (!options.some(option => option.key === '')) {
      options.push(emptyOption);
    }

    options.sort((a, b) => b.score - a.score);
    return {
      workName,
      rule,
      candidates,
      options,
      explored,
    };

    async function dfs(deck, start) {
      await ticker.tick();

      // 0〜5枚を候補にする
      if (deck.length > 0) {
        explored++;
        const detail = evaluateDeck(deck, rule);
        const option = {
          workName,
          deck: [...deck],
          score: detail.total,
          detail,
          key: deck.map(c => c.id).sort().join('|'),
          exploredAt: explored,
        };
        pushBestOption(bestOptions, option, maxKeep);
      }

      if (deck.length >= 5) return;
      if (start >= candidates.length) return;

      const remain = 5 - deck.length;
      const upperBound = estimateDeckUpperBound(deck, candidates, start, remain, rule);
      const worst = bestOptions.length >= maxKeep ? bestOptions[bestOptions.length - 1].score : -Infinity;
      if (bestOptions.length >= maxKeep && upperBound < worst) return;

      for (let i = start; i < candidates.length; i++) {
        deck.push(candidates[i]);
        await dfs(deck, i + 1);
        deck.pop();
      }
    }
  }

  function estimateDeckUpperBound(deck, candidates, start, remain, rule) {
    let score = 0;
    for (const c of deck) score += estimateCardValue(c, rule);
    for (let i = start; i < Math.min(candidates.length, start + remain); i++) {
      score += estimateCardValue(candidates[i], rule);
    }
    return score;
  }

  function pushBestOption(arr, option, maxKeep) {
    if (arr.some(x => x.key === option.key)) return;
    arr.push(option);
    arr.sort((a, b) => b.score - a.score);
    if (arr.length > maxKeep) arr.length = maxKeep;
  }

  async function findBestSingleWork(cards, workName) {
    const searched = await searchTopDeckOptions(cards, workName, 1);
    const top = searched.options[0] || { deck: [], score: 0, detail: { total: 0, byCard: {} } };
    return {
      workName,
      deck: top.deck,
      score: top.score,
      detail: top.detail,
      candidateCount: searched.candidates.length,
      explored: searched.explored,
    };
  }

  async function findGlobalBestAllocation(cards, works) {
    const unlockedWorks = works.filter(w => w.unlocked).map(w => w.name);
    const searchedByWork = [];
    for (const workName of unlockedWorks) {
      searchedByWork.push(await searchTopDeckOptions(cards, workName));
    }

    // 候補数が少ない順に並べた方が探索しやすい
    searchedByWork.sort((a, b) => a.options.length - b.options.length);

    let bestScore = 0;
    let bestByWork = Object.fromEntries(unlockedWorks.map(workName => [workName, {
      workName,
      deck: [],
      score: 0,
      detail: { total: 0, byCard: {} },
      key: '',
      exploredAt: 0,
    }]));
    let nodes = 0;
    const ticker = createOptimizationTicker();

    await dfs(0, new Set(), {}, 0);

    return {
      totalScore: bestScore,
      byWork: bestByWork,
      nodes,
      searchedByWork,
    };

    async function dfs(index, usedCardIds, currentByWork, currentScore) {
      await ticker.tick();
      nodes++;

      if (index >= searchedByWork.length) {
        if (currentScore > bestScore) {
          bestScore = currentScore;
          bestByWork = clonePlan(currentByWork);
        }
        return;
      }

      const optimistic = currentScore + sumRemainingBest(index);
      if (optimistic <= bestScore) return;

      const item = searchedByWork[index];
      const options = item.options;

      for (const option of options) {
        if (!canUseOption(option, usedCardIds)) continue;

        const added = [];
        for (const card of option.deck) {
          usedCardIds.add(card.id);
          added.push(card.id);
        }

        currentByWork[item.workName] = option;
        await dfs(index + 1, usedCardIds, currentByWork, currentScore + option.score);

        delete currentByWork[item.workName];
        for (const id of added) usedCardIds.delete(id);
      }
    }

    function sumRemainingBest(startIndex) {
      let s = 0;
      for (let i = startIndex; i < searchedByWork.length; i++) {
        s += searchedByWork[i].options[0]?.score || 0;
      }
      return s;
    }
  }

  function canUseOption(option, usedCardIds) {
    for (const card of option.deck) {
      if (usedCardIds.has(card.id)) return false;
    }
    return true;
  }

  function clonePlan(byWork) {
    const out = {};
    for (const [k, v] of Object.entries(byWork)) {
      out[k] = v;
    }
    return out;
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
    const res = await findBestSingleWork(cardsForWork, workName);
    state.singleResults[workName] = res;

    setResultHtml(renderSingleWorkResult(workName, res));
    setStatus(`${workName}: 最適化が完了しました`);
  }

  async function runGlobalOptimization() {
    reloadAll();

    const unlockedWorks = WORK_ORDER.filter(name => state.works.find(w => w.name === name && w.unlocked));
    const byWork = {};

    for (const workName of unlockedWorks) {
      reloadAll();

      const cardsForWork = [
        ...state.cards,
        ...getCardsCurrentlyInWork(workName),
      ];

      setStatus(`${workName}: 単体最適化を計算中...`);
      const res = await findBestSingleWork(cardsForWork, workName);
      state.singleResults[workName] = res;
      byWork[workName] = res;

      setResultHtml(renderGlobalPlan(buildMacroGlobalPlan(byWork, unlockedWorks)));
      setStatus(`${workName}: プランを更新しました`);
    }

    state.globalPlan = buildMacroGlobalPlan(byWork, unlockedWorks);
    setResultHtml(renderGlobalPlan(state.globalPlan));
    setStatus('全ワーク最適化が完了しました。必要なら「この全プランを自動セット」を押してください');
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

  function renderSingleWorkResult(workName, res) {
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
      ${renderDeckCards(res.deck, res.detail)}
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

      rows.push(`
        <div class="cpcc-card">
          <div class="cpcc-title">${escapeHtml(workName)}</div>
          <div class="cpcc-score">推定Power: ${formatNum(item.score || 0)}</div>
          <div class="cpcc-btns">
            <button class="green" data-cpcc-action="highlight-global">全プランをハイライト</button>
          </div>
        </div>
        ${renderDeckCards(item.deck || [], item.detail || { byCard: {} })}
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
      const d = detail?.byCard?.[c.id] || { bonusPercent: 0, baseAfterWork: c.power, finalPower: c.power };

      return `
      <div
        class="cpcc-card cpcc-result-card"
        data-cpcc-card-id="${escapeHtml(c.id)}"
        data-cpcc-card-name="${escapeHtml(c.name)}"
        title="クリックでカード位置へスクロール"
      >
        <div class="cpcc-title">${escapeHtml(c.name)} <span class="cpcc-sub">[${escapeHtml(c.rarity)}]</span></div>
        <div>部活: ${escapeHtml(c.club)} / 基礎Power: ${c.power}</div>
        <div>場効果後: ${formatNum(d.baseAfterWork)} / 部活補正: ${d.bonusPercent > 0 ? '+' : ''}${d.bonusPercent}% / 最終: ${formatNum(d.finalPower)}</div>
      </div>
    `;
    }).join('');
  }

  // =========================
  // 自動セット
  // =========================

  async function autoSetGlobalPlan(byWork) {
    setStatus('全プラン自動セットを開始します...');

    for (const workName of WORK_ORDER) {
      const item = byWork[workName];
      if (!item) continue;
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

    if (!diff.toRemove.length && !diff.toAdd.length) {
      setStatus(`${workName}: 差分がないため再セットを省略しました`);
      return;
    }

    setStatus(`${workName}: ${diff.toRemove.length} 枚解除 / ${diff.toAdd.length} 枚設定します`);
    await activateWorkBase(workName);

    for (const entry of diff.toRemove) {
      await activateWorkBase(workName);
      const rootNow = findWorkRoot(workName);
      const countBefore = rootNow ? parseCurrentCount(rootNow) : 0;
      if (countBefore <= 0) break;

      simulateClick(entry.root);
      highlightElement(entry.root, 'orange');
      await sleep(CONFIG.autoStepDelay);
      const changed = await waitForWorkCountLessThan(workName, countBefore, 4000);
      if (!changed) {
        console.warn('[CPCC] remove click did not reduce count', workName, entry.card);
        await sleep(CONFIG.autoClickDelayLong);
      }
    }

    for (const card of diff.toAdd) {
      const currentRoot = findWorkRoot(workName);
      const countBefore = currentRoot ? parseCurrentCount(currentRoot) : 0;
      if (countBefore >= 5) {
        console.warn('[CPCC] deck already full', workName, countBefore);
        setStatus(`${workName}: 既に5枚入っています`);
        break;
      }

      await activateWorkBase(workName);

      const cardRoot = findOwnedCardRootForSelectionEx(card, { excludeInDeck: true });
      if (!cardRoot) {
        console.warn('[CPCC] owned card root not found', card);
        setStatus(`${workName}: カードが見つかりません ${card.name}`);
        continue;
      }

      const target = findClickableCardTarget(cardRoot);
      if (!target) {
        console.warn('[CPCC] clickable target not found', card);
        setStatus(`${workName}: クリック対象が見つかりません ${card.name}`);
        continue;
      }

      console.log('[CPCC] click card', workName, card.name, target);
      simulateClick(target);
      highlightElement(target, 'red');
      await sleep(CONFIG.autoStepDelay);
      const changed = await waitForWorkCountAtLeast(workName, countBefore + 1, 2500);
      if (!changed) {
        console.warn('[CPCC] count did not increase', workName, card);
        await sleep(CONFIG.autoClickDelayLong);
      }
    }

    setStatus(`${workName}: 自動セット完了`);
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
          console.warn('[CPCC] clear click did not reduce count', workName, countBefore);
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

  function findOwnedCardRootForSelectionEx(card, opts = {}) {
    const excludeRoots = opts.excludeRoots || new Set();
    const excludeInDeck = !!opts.excludeInDeck;
    const rememberedRoots = [
      card?.root,
      state.cards.find(c => c.id === card.id)?.root,
    ].filter(Boolean);

    for (const root of rememberedRoots) {
      if (excludeRoots.has(root)) continue;
      if (excludeInDeck && root.classList.contains('in-deck')) continue;
      if (isMatchingCardRoot(root, card)) return root;
    }

    const roots = findOwnedCardRoots().filter(root => {
      if (excludeRoots.has(root)) return false;
      if (excludeInDeck && root.classList.contains('in-deck')) return false;
      return true;
    });

    // まずは厳密一致
    let exact = roots.find(root => {
      const parsed = parseCardSignature(root);
      return parsed &&
        parsed.name === card.name &&
        parsed.power === card.power &&
        parsed.club === card.club &&
        parsed.rarity === card.rarity;
    });
    if (exact) return exact;

    // 名前 + Power
    exact = roots.find(root => {
      const parsed = parseCardSignature(root);
      return parsed && parsed.name === card.name && parsed.power === card.power;
    });
    if (exact) return exact;

    // 名前だけ
    return roots.find(root => {
      const parsed = parseCardSignature(root);
      return parsed && parsed.name === card.name;
    }) || null;
  }

  function isMatchingCardRoot(root, card) {
    if (!root?.isConnected) return false;
    const parsed = parseCardSignature(root);
    if (!parsed) return false;

    return parsed.name === card.name &&
      parsed.power === card.power &&
      parsed.club === card.club &&
      parsed.rarity === card.rarity;
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
    });
  }

  function highlightDeck(deck, workName) {
    const usedRoots = new Set();

    for (const card of deck) {
      const root = findOwnedCardRootForSelectionEx(card, { excludeRoots: usedRoots });
      if (!root) {
        console.warn('[CPCC] highlight target not found', workName, card);
        continue;
      }

      usedRoots.add(root);
      root.classList.add('cpcc-highlight-card');
      root.setAttribute('data-cpcc-work', workName);
    }
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
