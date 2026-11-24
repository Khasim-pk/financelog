/* ════════════════════════════════════════════════════════════
   FinanceLog — app.js  v1.2
   Main application logic for the Telegram Mini App
════════════════════════════════════════════════════════════ */

// ─── Category Definitions ──────────────────────────────────────────────────────

const EXPENSE_CATS = [
    { id: 'emi',           icon: '🏦', name: 'EMI'          },
    { id: 'bills',         icon: '💡', name: 'Bills'        },
    { id: 'groceries',     icon: '🛒', name: 'Groceries'    },
    { id: 'medical',       icon: '💊', name: 'Medical'      },
    { id: 'fuel',          icon: '⛽', name: 'Fuel'         },
    { id: 'food',          icon: '🍽️', name: 'Outside Food' },
    { id: 'snacks',        icon: '☕', name: 'Snacks'       },
    { id: 'entertainment', icon: '🎬', name: 'Entertainment'},
    { id: 'travel',        icon: '✈️', name: 'Travel'       },
    { id: 'shopping',      icon: '🛍️', name: 'Shopping'     },
    { id: 'subscriptions', icon: '📺', name: 'Subscriptions'},
    { id: 'misc',          icon: '📦', name: 'Misc'         },
];

const INCOME_CATS = [
    { id: 'salary',    icon: '💰', name: 'Salary'    },
    { id: 'rental',    icon: '🏠', name: 'Rental'    },
    { id: 'freelance', icon: '💼', name: 'Freelance' },
    { id: 'other',     icon: '💵', name: 'Other'     },
];

const ALL_CATS = [...EXPENSE_CATS, ...INCOME_CATS];

// ─── App State ─────────────────────────────────────────────────────────────────

let db;                          // Supabase client
let currentType    = 'expense';  // 'expense' | 'income'
let selectedCat    = null;       // selected category id
let selectedPay    = 'UPI';      // 'UPI' | 'Cash' | 'Credit Card'
let currentFilter  = 'week';     // 'week' | 'month' | 'pick'
let summaryMonth   = new Date(); // month shown in Summary
let monthlyBudget  = 0;          // stored monthly budget amount
let weeklyBudget   = 0;          // stored weekly budget amount
let selectedEMIIcon = '🏠';      // currently selected icon in Add EMI form

// ─── Initialise ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

    // Tell Telegram the app is ready and expand to full height
    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
    }

    // Create Supabase client (credentials come from config.js)
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Set date picker to today
    document.getElementById('date-input').value = todayStr();

    // Render the initial category grid
    renderCatGrid();

    // Load saved budget from DB
    loadBudget();

    // Run EMI auto-deduction on startup
    runEMIAutoDeduct();
});

// ─── Utility Helpers ───────────────────────────────────────────────────────────

/** Returns today as YYYY-MM-DD */
function todayStr() {
    return new Date().toISOString().split('T')[0];
}

/** Format a number as Indian currency: ₹1,23,456 */
function inr(amount) {
    return '₹' + Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Format a date string (YYYY-MM-DD) as "31 Oct 2026" */
function fmtDate(str) {
    const d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Return "October 2026" style label for a Date object */
function monthLabel(d) {
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** Return "16 Oct" style short label */
function shortDateLabel(d) {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

let toastTimer = null;

/** Show a brief toast message at the bottom */
function toast(msg, ms = 2200) {
    const el = document.getElementById('toast');
    if (!el) return;

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }

    el.textContent = msg;
    el.classList.add('show');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('show');
    }, ms);
}

// ─── View Navigation ───────────────────────────────────────────────────────────

function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${name}-view`).classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`nav-${name}`).classList.add('active');

    if (name === 'history') loadHistory();
    if (name === 'summary') loadSummary();
    if (name === 'track')   loadTrack();
}

// ─── Home — Quick Add ──────────────────────────────────────────────────────────

function setType(type) {
    currentType = type;
    selectedCat = null;

    document.getElementById('btn-expense').classList.toggle('active', type === 'expense');
    document.getElementById('btn-income').classList.toggle('active', type === 'income');

    document.getElementById('payment-section').style.display =
        type === 'expense' ? 'block' : 'none';

    renderCatGrid();
}

function renderCatGrid() {
    const cats = currentType === 'expense' ? EXPENSE_CATS : INCOME_CATS;
    const grid = document.getElementById('category-grid');
    grid.innerHTML = cats.map(c => `
        <div class="cat-item ${selectedCat === c.id ? 'selected' : ''}"
             onclick="pickCat('${c.id}')">
            <div class="cat-icon">${c.icon}</div>
            <div class="cat-name">${c.name}</div>
        </div>
    `).join('');
}

function pickCat(id) {
    selectedCat = id;
    renderCatGrid();
}

function setPayment(btn) {
    selectedPay = btn.dataset.pay;
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
}

async function saveTransaction() {
    const amount = parseFloat(document.getElementById('amount-input').value);
    const date   = document.getElementById('date-input').value;
    const notes  = document.getElementById('notes-input').value.trim();

    if (!amount || amount <= 0) { toast('⚠️ Please enter a valid amount'); return; }
    if (!selectedCat)           { toast('⚠️ Please select a category');    return; }
    if (!date)                  { toast('⚠️ Please pick a date');          return; }

    const record = {
        type:         currentType,
        amount:       amount,
        category:     selectedCat,
        payment_mode: currentType === 'expense' ? selectedPay : null,
        notes:        notes || null,
        date:         date,
    };

    const btn = document.getElementById('save-btn');
    btn.textContent = 'Saving…';
    btn.disabled = true;

    const { error } = await db.from('transactions').insert([record]);

    btn.textContent = 'Save';
    btn.disabled = false;

    if (error) {
        console.error('Save error:', error);
        toast('❌ Failed to save. Please try again.');
        return;
    }

    document.getElementById('amount-input').value = '';
    document.getElementById('notes-input').value  = '';
    document.getElementById('date-input').value   = todayStr();
    selectedCat = null;
    renderCatGrid();

    toast('✅ Saved successfully!');
}

// ─── Budget / Limits Settings ──────────────────────────────────────────────────

async function loadBudget() {
    const { data } = await db
        .from('budget_settings')
        .select('monthly_budget, weekly_budget')
        .eq('id', 1)
        .single();

    if (data) {
        monthlyBudget = parseFloat(data.monthly_budget) || 0;
        weeklyBudget  = parseFloat(data.weekly_budget)  || 0;
    }
}

function openBudgetSettings() {
    document.getElementById('budget-input').value        = monthlyBudget > 0 ? monthlyBudget : '';
    document.getElementById('weekly-budget-input').value = weeklyBudget  > 0 ? weeklyBudget  : '';
    document.getElementById('budget-modal').style.display = 'flex';
}

function closeBudgetSettings() {
    document.getElementById('budget-modal').style.display = 'none';
}

async function saveBudget() {
    const monthly = parseFloat(document.getElementById('budget-input').value);
    const weekly  = parseFloat(document.getElementById('weekly-budget-input').value);

    if (!monthly || monthly <= 0) { toast('⚠️ Enter a valid monthly limit'); return; }
    if (!weekly  || weekly  <= 0) { toast('⚠️ Enter a valid weekly limit');  return; }

    const { error } = await db.from('budget_settings').upsert({
        id:             1,
        monthly_budget: monthly,
        weekly_budget:  weekly,
        updated_at:     new Date().toISOString(),
    });

    if (error) { toast('❌ Failed to save limits'); return; }

    monthlyBudget = monthly;
    weeklyBudget  = weekly;
    closeBudgetSettings();
    toast('✅ Limits updated!');

    // Refresh Track view if it's active
    const trackView = document.getElementById('track-view');
    if (trackView && trackView.classList.contains('active')) loadTrack();
}

// ─── History View ──────────────────────────────────────────────────────────────

function setFilter(btn) {
    currentFilter = btn.dataset.filter;

    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    const picker = document.getElementById('month-picker');
    picker.style.display = currentFilter === 'pick' ? 'block' : 'none';

    if (currentFilter !== 'pick') loadHistory();
}

async function loadHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '<p class="loading-state">Loading…</p>';

    const now = new Date();
    let from, to;

    if (currentFilter === 'week') {
        const day  = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon  = new Date(now);
        mon.setDate(now.getDate() + diff);
        from = mon.toISOString().split('T')[0];
        to   = todayStr();

    } else if (currentFilter === 'month') {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        from = `${y}-${m}-01`;
        to   = todayStr();

    } else {
        const val = document.getElementById('month-picker').value;
        if (!val) {
            list.innerHTML = '<p class="empty-state">Select a month above</p>';
            return;
        }
        const [y, m] = val.split('-');
        const last   = new Date(Number(y), Number(m), 0).getDate();
        from = `${y}-${m}-01`;
        to   = `${y}-${m}-${String(last).padStart(2, '0')}`;
    }

    const { data, error } = await db
        .from('transactions')
        .select('*')
        .gte('date', from)
        .lte('date', to)
        .order('date',       { ascending: false })
        .order('created_at', { ascending: false });

    if (error) {
        list.innerHTML = '<p class="empty-state">Failed to load. Check your connection.</p>';
        return;
    }
    if (!data || data.length === 0) {
        list.innerHTML = '<p class="empty-state">No transactions found for this period.</p>';
        return;
    }

    list.innerHTML = data.map(t => {
        const cat    = ALL_CATS.find(c => c.id === t.category);
        const isExp  = t.type === 'expense';
        const meta   = [t.payment_mode, t.notes].filter(Boolean).join(' · ');
        return `
        <div class="txn-item" id="txn-${t.id}">
            <div class="txn-emoji">${cat?.icon ?? '💰'}</div>
            <div class="txn-body">
                <div class="txn-cat">${cat?.name ?? t.category}</div>
                ${meta ? `<div class="txn-meta">${meta}</div>` : ''}
            </div>
            <div class="txn-right">
                <div class="txn-amount ${isExp ? 'expense' : 'income'}">
                    ${isExp ? '-' : '+'}${inr(t.amount)}
                </div>
                <div class="txn-date">${fmtDate(t.date)}</div>
            </div>
            <button class="del-btn" onclick="deleteTxn('${t.id}')">🗑️</button>
        </div>`;
    }).join('');
}

async function deleteTxn(id) {
    if (!confirm('Delete this transaction?')) return;

    const { error } = await db.from('transactions').delete().eq('id', id);
    if (error) { toast('❌ Delete failed'); return; }

    document.getElementById(`txn-${id}`)?.remove();

    const list = document.getElementById('history-list');
    if (list && !list.querySelector('.txn-item')) {
        list.innerHTML = '<p class="empty-state">No transactions found for this period.</p>';
    }
    toast('🗑️ Deleted');
}

// ─── Summary View ──────────────────────────────────────────────────────────────

function shiftMonth(dir) {
    summaryMonth.setMonth(summaryMonth.getMonth() + dir);
    loadSummary();
}

async function loadSummary() {
    document.getElementById('summary-month-label').textContent = monthLabel(summaryMonth);

    const y    = summaryMonth.getFullYear();
    const m    = String(summaryMonth.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, summaryMonth.getMonth() + 1, 0).getDate();
    const from = `${y}-${m}-01`;
    const to   = `${y}-${m}-${String(last).padStart(2, '0')}`;

    const { data, error } = await db
        .from('transactions')
        .select('*')
        .gte('date', from)
        .lte('date', to);

    if (error) return;

    const expenses = (data || []).filter(t => t.type === 'expense');
    const incomes  = (data || []).filter(t => t.type === 'income');

    const totalExp = expenses.reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalInc = incomes.reduce((s, t)  => s + parseFloat(t.amount), 0);

    document.getElementById('total-income').textContent = inr(totalInc);
    document.getElementById('total-spent').textContent  = inr(totalExp);

    renderBudgetBar(totalExp);
    renderCategoryBreakdown(expenses, totalExp);
    renderPaymentBreakdown(expenses, y, summaryMonth.getMonth());
}

function renderBudgetBar(totalExp) {
    const box = document.getElementById('budget-box');
    if (monthlyBudget <= 0) { box.style.display = 'none'; return; }
    box.style.display = 'block';

    const pct  = Math.min((totalExp / monthlyBudget) * 100, 100);
    const fill = document.getElementById('budget-fill');
    fill.style.width = pct + '%';
    fill.className   = 'budget-fill' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warn' : '');

    document.getElementById('budget-ratio').textContent =
        `${inr(totalExp)} / ${inr(monthlyBudget)}`;

    const alert = document.getElementById('budget-alert');
    alert.style.display = pct >= 90 ? 'block' : 'none';
}

function renderCategoryBreakdown(expenses, totalExp) {
    const el = document.getElementById('category-breakdown');

    const catMap = {};
    expenses.forEach(t => {
        catMap[t.category] = (catMap[t.category] || 0) + parseFloat(t.amount);
    });

    const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
        el.innerHTML = '<p class="empty-state" style="padding:16px 0">No expenses this month</p>';
        return;
    }

    el.innerHTML = sorted.map(([id, amt]) => {
        const cat = EXPENSE_CATS.find(c => c.id === id);
        const pct = totalExp > 0 ? ((amt / totalExp) * 100).toFixed(1) : '0.0';
        return `
        <div class="sum-item">
            <div class="sum-icon">${cat?.icon ?? '📦'}</div>
            <div class="sum-info">
                <div class="sum-name">${cat?.name ?? id}</div>
                <div class="mini-track">
                    <div class="mini-fill" style="width:${pct}%"></div>
                </div>
            </div>
            <div class="sum-right">
                <div class="sum-amount">${inr(amt)}</div>
                <div class="sum-pct">${pct}%</div>
            </div>
        </div>`;
    }).join('');
}

// ─── Payment Mode Breakdown (with CC Billing Cycle) ───────────────────────────

async function renderPaymentBreakdown(expenses, calYear, calMonthIdx) {
    const el = document.getElementById('payment-breakdown');

    // Separate CC and non-CC expenses from the calendar month
    const nonCC = expenses.filter(t => t.payment_mode !== 'Credit Card');
    const payMap = {};
    nonCC.forEach(t => {
        if (t.payment_mode) {
            payMap[t.payment_mode] = (payMap[t.payment_mode] || 0) + parseFloat(t.amount);
        }
    });

    const icons = { 'UPI': '📱', 'Cash': '💵' };
    const rows  = Object.entries(payMap)
        .sort((a, b) => b[1] - a[1])
        .map(([mode, amt]) => `
        <div class="pay-item">
            <div class="pay-name">${icons[mode] ?? ''} ${mode}</div>
            <div class="pay-amount">${inr(amt)}</div>
        </div>`);

    // ── Credit Card billing cycle block ──────────────────────────────────────
    // Determine which billing cycle(s) end(s) in this calendar month:
    // Bill A: ends on 15th of calMonth  → starts on 16th of prev month
    // After the 16th, a 2nd cycle (Bill B) is accumulating:
    // Bill B: starts on 16th of calMonth → ends on 15th of next month

    const isCurrentMonth = (calYear === new Date().getFullYear() &&
                            calMonthIdx === new Date().getMonth());
    const todayDay = new Date().getDate();

    // Bill A: (prev month 16th) → (this month 15th)
    const billAFrom = new Date(calYear, calMonthIdx - 1, 16);
    const billATo   = new Date(calYear, calMonthIdx,     15);

    const billAFromStr = billAFrom.toISOString().split('T')[0];
    const billAToStr   = billATo.toISOString().split('T')[0];

    // Fetch Bill A CC transactions
    const { data: ccDataA } = await db
        .from('transactions')
        .select('amount')
        .eq('payment_mode', 'Credit Card')
        .gte('date', billAFromStr)
        .lte('date', billAToStr);

    const billATotal = (ccDataA || []).reduce((s, t) => s + parseFloat(t.amount), 0);

    const billALabel = `${shortDateLabel(billAFrom)} – ${shortDateLabel(billATo)}`;

    let ccHTML = '';

    // Show Bill B only when viewing current month AND today ≥ 16th
    if (isCurrentMonth && todayDay >= 16) {
        const billBFrom = new Date(calYear, calMonthIdx,     16);
        const billBTo   = new Date(calYear, calMonthIdx + 1, 15);

        const billBFromStr = billBFrom.toISOString().split('T')[0];
        const billBToStr   = billBTo.toISOString().split('T')[0];

        const { data: ccDataB } = await db
            .from('transactions')
            .select('amount')
            .eq('payment_mode', 'Credit Card')
            .gte('date', billBFromStr)
            .lte('date', billBToStr);

        const billBTotal = (ccDataB || []).reduce((s, t) => s + parseFloat(t.amount), 0);
        const billBLabel = `${shortDateLabel(billBFrom)} – ${shortDateLabel(billBTo)}`;

        ccHTML = `
        <div class="pay-item cc-bill-item">
            <div class="cc-bill-section">
                <div class="cc-bill-header">💳 Credit Card</div>
                <div class="cc-bill-row">
                    <span class="cc-bill-label">Bill: ${billALabel}</span>
                    <span class="cc-bill-amount">${inr(billATotal)}</span>
                </div>
                <div class="cc-bill-divider"></div>
                <div class="cc-bill-row next">
                    <span class="cc-bill-label">Next: ${billBLabel}</span>
                    <span class="cc-bill-amount">${inr(billBTotal)}</span>
                </div>
            </div>
        </div>`;
    } else if (billATotal > 0) {
        ccHTML = `
        <div class="pay-item cc-bill-item">
            <div class="cc-bill-section">
                <div class="cc-bill-header">💳 Credit Card</div>
                <div class="cc-bill-row">
                    <span class="cc-bill-label">Bill: ${billALabel}</span>
                    <span class="cc-bill-amount">${inr(billATotal)}</span>
                </div>
            </div>
        </div>`;
    }

    if (rows.length === 0 && !ccHTML) {
        el.innerHTML = '<p class="empty-state" style="padding:16px 0 24px">No data</p>';
        return;
    }

    el.innerHTML = rows.join('') + ccHTML;
}

// ─── Track View — Limits & EMI ─────────────────────────────────────────────────

async function loadTrack() {
    renderLimits();
    loadEMIList();
}

async function renderLimits() {
    const now  = new Date();
    const y    = now.getFullYear();
    const m    = String(now.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, now.getMonth() + 1, 0).getDate();

    // ── Monthly spend (1st → today) ──
    const { data: monthData } = await db
        .from('transactions')
        .select('amount')
        .eq('type', 'expense')
        .gte('date', `${y}-${m}-01`)
        .lte('date', todayStr());

    const monthSpent = (monthData || []).reduce((s, t) => s + parseFloat(t.amount), 0);

    // ── Weekly spend (Mon → today) ──
    const day  = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon  = new Date(now);
    mon.setDate(now.getDate() + diff);
    const monStr = mon.toISOString().split('T')[0];

    const { data: weekData } = await db
        .from('transactions')
        .select('amount')
        .eq('type', 'expense')
        .gte('date', monStr)
        .lte('date', todayStr());

    const weekSpent = (weekData || []).reduce((s, t) => s + parseFloat(t.amount), 0);

    // ── Render Monthly ──
    renderLimitBar({
        spent:     monthSpent,
        limit:     monthlyBudget,
        fillId:    'monthly-limit-fill',
        ratioId:   'monthly-limit-ratio',
        remainId:  'monthly-limit-remaining',
        label:     `${now.toLocaleDateString('en-IN', { month: 'long' })}`,
    });

    // ── Render Weekly ──
    const weekLabel = `${shortDateLabel(mon)} – ${shortDateLabel(now)}`;
    document.getElementById('weekly-limit-label').textContent = `This Week  (${weekLabel})`;

    renderLimitBar({
        spent:     weekSpent,
        limit:     weeklyBudget,
        fillId:    'weekly-limit-fill',
        ratioId:   'weekly-limit-ratio',
        remainId:  'weekly-limit-remaining',
    });
}

function renderLimitBar({ spent, limit, fillId, ratioId, remainId }) {
    const ratioEl  = document.getElementById(ratioId);
    const fillEl   = document.getElementById(fillId);
    const remainEl = document.getElementById(remainId);

    if (limit <= 0) {
        ratioEl.textContent  = '— / —';
        fillEl.style.width   = '0%';
        fillEl.className     = 'budget-fill';
        remainEl.textContent = 'No limit set — tap ⚙️ to set one';
        remainEl.className   = 'limit-remaining';
        return;
    }

    const pct       = Math.min((spent / limit) * 100, 100);
    const remaining = limit - spent;

    ratioEl.textContent  = `${inr(spent)} / ${inr(limit)}`;
    fillEl.style.width   = pct + '%';
    fillEl.className     = 'budget-fill' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warn' : '');

    if (remaining >= 0) {
        remainEl.textContent = `${inr(remaining)} remaining`;
        remainEl.className   = 'limit-remaining' + (pct >= 90 ? ' danger' : '');
    } else {
        remainEl.textContent = `${inr(Math.abs(remaining))} over limit!`;
        remainEl.className   = 'limit-remaining danger';
    }
}

// ─── EMI Tracker ───────────────────────────────────────────────────────────────

async function loadEMIList() {
    const el = document.getElementById('emi-list');
    el.innerHTML = '<p class="loading-state">Loading…</p>';

    const { data, error } = await db
        .from('emi_tracker')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        el.innerHTML = '<p class="empty-state">Failed to load loans.</p>';
        return;
    }
    if (!data || data.length === 0) {
        el.innerHTML = '<p class="empty-state" style="padding:24px 0">No EMIs added yet. Tap ➕ to add one.</p>';
        return;
    }

    el.innerHTML = data.map(loan => renderEMICard(loan)).join('');
}

function renderEMICard(loan) {
    const totalPaid      = parseFloat(loan.total_paid);
    const totalAmt       = parseFloat(loan.total_amount);
    const paidPct        = totalAmt > 0 ? Math.min((totalPaid / totalAmt) * 100, 100).toFixed(1) : '0.0';
    const monthsLeft     = loan.remaining_tenure;
    const totalTenure    = loan.total_tenure;
    const monthsPaid     = totalTenure - monthsLeft;
    const isComplete     = monthsLeft <= 0 || !loan.is_active;

    const tenureBar = `
        <div class="mini-track" style="margin-top:5px">
            <div class="mini-fill emi-fill" style="width:${paidPct}%"></div>
        </div>`;

    return `
    <div class="emi-card ${isComplete ? 'completed' : ''}" id="emi-card-${loan.id}">
        <div class="emi-header">
            <div class="emi-icon">${loan.loan_icon}</div>
            <div class="emi-info">
                <div class="emi-name">${loan.loan_name}</div>
                <div class="emi-per-month">${inr(loan.emi_amount)} / month</div>
            </div>
            ${isComplete
                ? '<span class="emi-badge">✅ Paid Off</span>'
                : `<button class="del-btn" onclick="deleteEMI('${loan.id}')" title="Remove loan">🗑️</button>`
            }
        </div>
        <div class="emi-progress-section">
            <div class="emi-progress-header">
                <span>Paid: ${inr(totalPaid)}</span>
                <span>Total: ${inr(totalAmt)}</span>
            </div>
            <div class="budget-track">
                <div class="budget-fill emi-fill" style="width:${paidPct}%"></div>
            </div>
            <div class="emi-tenure">
                <span>${monthsPaid} of ${totalTenure} months paid</span>
                <span>${isComplete ? 'Complete!' : `${monthsLeft} months left`}</span>
            </div>
        </div>
    </div>`;
}

// ─── Add EMI Modal ─────────────────────────────────────────────────────────────

// ─── Add EMI Modal ─────────────────────────────────────────────────────────────

function openAddEMI() {
    // Reset form
    document.getElementById('emi-name').value        = '';
    document.getElementById('emi-total').value       = '';
    document.getElementById('emi-monthly').value     = '';
    document.getElementById('emi-tenure').value      = '';
    document.getElementById('emi-paid-months').value = '0';
    // default icon via select dropdown
    document.getElementById('emi-icon-select').value = '🏠';
    selectedEMIIcon = '🏠';
    document.getElementById('emi-modal').style.display = 'flex';
}

function closeAddEMI() {
    document.getElementById('emi-modal').style.display = 'none';
    closeKeyboard(); // dismiss on close
}

function closeKeyboard() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
}

function pickEMIIcon(btn) {
    // Keep backward compatibility; update select as well
    selectedEMIIcon = btn.dataset.icon;
    document.getElementById('emi-icon-select').value = selectedEMIIcon;
    document.querySelectorAll('.icon-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
}

async function saveEMI() {
    const name       = document.getElementById('emi-name').value.trim();
    const totalAmt   = parseFloat(document.getElementById('emi-total').value);
    const emiAmt     = parseFloat(document.getElementById('emi-monthly').value);
    const tenure     = parseInt(document.getElementById('emi-tenure').value,  10);
    const paidMonths = parseInt(document.getElementById('emi-paid-months').value, 10) || 0;
    const icon       = document.getElementById('emi-icon-select').value;

    const name       = document.getElementById('emi-name').value.trim();
    const totalAmt   = parseFloat(document.getElementById('emi-total').value);
    const emiAmt     = parseFloat(document.getElementById('emi-monthly').value);
    const tenure     = parseInt(document.getElementById('emi-tenure').value,  10);
    const paidMonths = parseInt(document.getElementById('emi-paid-months').value, 10) || 0;

    if (!name)                        { toast('⚠️ Enter a loan name');           return; }
    if (!totalAmt || totalAmt <= 0)   { toast('⚠️ Enter total loan amount');     return; }
    if (!emiAmt   || emiAmt   <= 0)   { toast('⚠️ Enter monthly EMI amount');    return; }
    if (!tenure   || tenure   <= 0)   { toast('⚠️ Enter total tenure in months');return; }
    if (paidMonths < 0 || paidMonths >= tenure) {
        toast('⚠️ Paid months must be between 0 and tenure-1'); return;
    }

    const remaining  = tenure - paidMonths;
    const totalPaid  = emiAmt * paidMonths;

    // Start date = today minus paidMonths months
    const startD = new Date();
    startD.setMonth(startD.getMonth() - paidMonths);
    const startDate = startD.toISOString().split('T')[0];

    // last_deducted = 1st of this month (so we don't double-deduct on first open)
    const now = new Date();
    const lastDeducted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const record = {
        loan_name:        name,
        loan_icon:        selectedEMIIcon,
        total_amount:     totalAmt,
        emi_amount:       emiAmt,
        total_tenure:     tenure,
        remaining_tenure: remaining,
        total_paid:       totalPaid,
        start_date:       startDate,
        last_deducted:    lastDeducted,
        is_active:        remaining > 0,
    };

    const saveBtn = document.querySelector('#emi-modal .modal-save');
    saveBtn.textContent = 'Saving…';
    saveBtn.disabled = true;

    const { error } = await db.from('emi_tracker').insert([record]);

    saveBtn.textContent = 'Save';
    saveBtn.disabled = false;

    if (error) { console.error(error); toast('❌ Failed to save EMI'); return; }

    closeAddEMI();
    toast('✅ Loan added!');
    loadEMIList();
}

async function deleteEMI(id) {
    if (!confirm('Remove this loan from tracker?')) return;

    const { error } = await db.from('emi_tracker').delete().eq('id', id);
    if (error) { toast('❌ Delete failed'); return; }

    document.getElementById(`emi-card-${id}`)?.remove();
    const list = document.getElementById('emi-list');
    if (list && !list.querySelector('.emi-card')) {
        list.innerHTML = '<p class="empty-state" style="padding:24px 0">No EMIs added yet. Tap ➕ to add one.</p>';
    }
    toast('🗑️ Removed');
}

// ─── EMI Auto-Deduction (on app open) ─────────────────────────────────────────
// On every app open, check if 1st of the current month has passed since
// last_deducted. If so, reduce remaining_tenure and increase total_paid.

async function runEMIAutoDeduct() {
    const now       = new Date();
    const thisFirst = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisFirstStr = thisFirst.toISOString().split('T')[0];

    const { data: loans, error } = await db
        .from('emi_tracker')
        .select('*')
        .eq('is_active', true);

    if (error || !loans || loans.length === 0) return;

    for (const loan of loans) {
        // Calculate how many 1st-of-months have passed since last_deducted
        const lastDeductedDate = loan.last_deducted
            ? new Date(loan.last_deducted + 'T00:00:00')
            : new Date(loan.start_date   + 'T00:00:00');

        // Count missed months: months where the 1st has already passed
        let missed = 0;
        const cursor = new Date(lastDeductedDate);
        cursor.setMonth(cursor.getMonth() + 1); // move to next 1st
        cursor.setDate(1);

        while (cursor <= thisFirst) {
            missed++;
            cursor.setMonth(cursor.getMonth() + 1);
        }

        if (missed === 0) continue;

        // Cap so we don't go below 0 tenure
        const actualMissed       = Math.min(missed, loan.remaining_tenure);
        const newRemaining       = loan.remaining_tenure - actualMissed;
        const newPaid            = parseFloat(loan.total_paid) + parseFloat(loan.emi_amount) * actualMissed;
        const nowActive          = newRemaining > 0;

        await db.from('emi_tracker').update({
            remaining_tenure: newRemaining,
            total_paid:       newPaid,
            last_deducted:    thisFirstStr,
            is_active:        nowActive,
        }).eq('id', loan.id);
    }
}
