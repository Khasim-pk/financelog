/* ════════════════════════════════════════════════════════════
   FinanceLog — app.js
   Main application logic for the Telegram Mini App
════════════════════════════════════════════════════════════ */

// ─── Category Definitions ──────────────────────────────────────────────────────

const EXPENSE_CATS = [
    { id: 'emi',           icon: '🏦', name: 'EMI'           },
    { id: 'bills',         icon: '💡', name: 'Bills'         },
    { id: 'groceries',     icon: '🛒', name: 'Groceries'     },
    { id: 'medical',       icon: '💊', name: 'Medical'       },
    { id: 'fuel',          icon: '⛽', name: 'Fuel'          },
    { id: 'food',          icon: '🍽️', name: 'Food'          },
    { id: 'entertainment', icon: '🎬', name: 'Entertainment' },
    { id: 'travel',        icon: '✈️', name: 'Travel'        },
    { id: 'shopping',      icon: '🛍️', name: 'Shopping'      },
    { id: 'subscriptions', icon: '📺', name: 'Subscriptions' },
    { id: 'misc',          icon: '📦', name: 'Misc'          },
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
let currentFilter  = 'month';    // 'week' | 'month' | 'pick'
let summaryMonth   = new Date(); // month shown in Summary
let monthlyBudget  = 0;          // stored monthly budget amount

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
    const d = new Date(str + 'T00:00:00'); // avoid timezone shift
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Return "October 2026" style label for a Date object */
function monthLabel(d) {
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** Show a brief toast message at the bottom */
function toast(msg, ms = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), ms);
}

// ─── View Navigation ───────────────────────────────────────────────────────────

function showView(name) {
    // Switch view panels
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${name}-view`).classList.add('active');

    // Switch nav buttons
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`nav-${name}`).classList.add('active');

    // Trigger data load for the opened view
    if (name === 'history') loadHistory();
    if (name === 'summary') loadSummary();
}

// ─── Home — Quick Add ──────────────────────────────────────────────────────────

/** Toggle between Expense and Income modes */
function setType(type) {
    currentType = type;
    selectedCat = null;

    document.getElementById('btn-expense').classList.toggle('active', type === 'expense');
    document.getElementById('btn-income').classList.toggle('active', type === 'income');

    // Payment mode is only relevant for expenses
    document.getElementById('payment-section').style.display =
        type === 'expense' ? 'block' : 'none';

    renderCatGrid();
}

/** Render category grid based on current type */
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

/** Select a category */
function pickCat(id) {
    selectedCat = id;
    renderCatGrid();
}

/** Select a payment mode pill */
function setPayment(btn) {
    selectedPay = btn.dataset.pay;
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
}

/** Save a new transaction to Supabase */
async function saveTransaction() {
    const amount = parseFloat(document.getElementById('amount-input').value);
    const date   = document.getElementById('date-input').value;
    const notes  = document.getElementById('notes-input').value.trim();

    // Validation
    if (!amount || amount <= 0)   { toast('⚠️ Please enter a valid amount'); return; }
    if (!selectedCat)             { toast('⚠️ Please select a category');    return; }
    if (!date)                    { toast('⚠️ Please pick a date');          return; }

    const record = {
        type:         currentType,
        amount:       amount,
        category:     selectedCat,
        payment_mode: currentType === 'expense' ? selectedPay : null,
        notes:        notes || null,
        date:         date,
    };

    // Disable save button while saving
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

    // Reset form on success
    document.getElementById('amount-input').value = '';
    document.getElementById('notes-input').value  = '';
    document.getElementById('date-input').value   = todayStr();
    selectedCat = null;
    renderCatGrid();

    toast('✅ Saved successfully!');
}

// ─── Budget Settings ───────────────────────────────────────────────────────────

/** Load saved monthly budget from Supabase */
async function loadBudget() {
    const { data } = await db
        .from('budget_settings')
        .select('monthly_budget')
        .eq('id', 1)
        .single();

    if (data) monthlyBudget = parseFloat(data.monthly_budget) || 0;
}

/** Open the budget modal */
function openBudgetSettings() {
    document.getElementById('budget-input').value = monthlyBudget > 0 ? monthlyBudget : '';
    document.getElementById('budget-modal').style.display = 'flex';
}

/** Close the budget modal */
function closeBudgetSettings() {
    document.getElementById('budget-modal').style.display = 'none';
}

/** Save the monthly budget to Supabase */
async function saveBudget() {
    const val = parseFloat(document.getElementById('budget-input').value);
    if (!val || val <= 0) { toast('⚠️ Enter a valid budget amount'); return; }

    const { error } = await db.from('budget_settings').upsert({
        id:             1,
        monthly_budget: val,
        updated_at:     new Date().toISOString(),
    });

    if (error) { toast('❌ Failed to save budget'); return; }

    monthlyBudget = val;
    closeBudgetSettings();
    toast('✅ Budget updated!');
}

// ─── History View ──────────────────────────────────────────────────────────────

/** Switch the date filter tab */
function setFilter(btn) {
    currentFilter = btn.dataset.filter;

    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    const picker = document.getElementById('month-picker');
    picker.style.display = currentFilter === 'pick' ? 'block' : 'none';

    if (currentFilter !== 'pick') loadHistory();
}

/** Load and render transaction history */
async function loadHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '<p class="loading-state">Loading…</p>';

    // Calculate date range
    const now = new Date();
    let from, to;

    if (currentFilter === 'week') {
        // Monday of current week → today
        const day  = now.getDay(); // 0=Sun
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
        // User-picked month
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

/** Delete a single transaction */
async function deleteTxn(id) {
    if (!confirm('Delete this transaction?')) return;

    const { error } = await db.from('transactions').delete().eq('id', id);
    if (error) { toast('❌ Delete failed'); return; }

    document.getElementById(`txn-${id}`)?.remove();

    // Show empty state if list is now empty
    const list = document.getElementById('history-list');
    if (list && !list.querySelector('.txn-item')) {
        list.innerHTML = '<p class="empty-state">No transactions found for this period.</p>';
    }
    toast('🗑️ Deleted');
}

// ─── Summary View ──────────────────────────────────────────────────────────────

/** Move the summary one month forward or back */
function shiftMonth(dir) {
    summaryMonth.setMonth(summaryMonth.getMonth() + dir);
    loadSummary();
}

/** Load and render the summary for summaryMonth */
async function loadSummary() {
    // Update month label
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

    // ── Cards
    document.getElementById('total-income').textContent = inr(totalInc);
    document.getElementById('total-spent').textContent  = inr(totalExp);

    // ── Budget bar
    renderBudgetBar(totalExp);

    // ── Category breakdown
    renderCategoryBreakdown(expenses, totalExp);

    // ── Payment mode breakdown
    renderPaymentBreakdown(expenses);
}

function renderBudgetBar(totalExp) {
    const box = document.getElementById('budget-box');
    if (monthlyBudget <= 0) { box.style.display = 'none'; return; }
    box.style.display = 'block';

    const pct   = Math.min((totalExp / monthlyBudget) * 100, 100);
    const fill  = document.getElementById('budget-fill');
    fill.style.width = pct + '%';
    fill.className   = 'budget-fill' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warn' : '');

    document.getElementById('budget-ratio').textContent =
        `${inr(totalExp)} / ${inr(monthlyBudget)}`;

    const alert = document.getElementById('budget-alert');
    alert.style.display = pct >= 90 ? 'block' : 'none';
}

function renderCategoryBreakdown(expenses, totalExp) {
    const el = document.getElementById('category-breakdown');

    // Sum by category
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

function renderPaymentBreakdown(expenses) {
    const el = document.getElementById('payment-breakdown');

    const payMap = {};
    expenses.forEach(t => {
        if (t.payment_mode) {
            payMap[t.payment_mode] = (payMap[t.payment_mode] || 0) + parseFloat(t.amount);
        }
    });

    const modes = Object.entries(payMap).sort((a, b) => b[1] - a[1]);

    if (modes.length === 0) {
        el.innerHTML = '<p class="empty-state" style="padding:16px 0 24px">No data</p>';
        return;
    }

    const icons = { 'UPI': '📱', 'Cash': '💵', 'Credit Card': '💳' };
    el.innerHTML = modes.map(([mode, amt]) => `
        <div class="pay-item">
            <div class="pay-name">${icons[mode] ?? ''} ${mode}</div>
            <div class="pay-amount">${inr(amt)}</div>
        </div>
    `).join('');
}
