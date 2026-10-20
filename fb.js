// Firebase backend for the payroll app: login, roles, Firestore adapter, downloads, install
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, doc, collection, query, where, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.__fbLoaded = true;
const firebaseConfig = {
  apiKey: "AIzaSyBHLQ3Qmwe8j_AaLjxaGqzKGS0a2R-XJbs",
  authDomain: "payrol-1847d.firebaseapp.com",
  projectId: "payrol-1847d",
  storageBucket: "payrol-1847d.firebasestorage.app",
  messagingSenderId: "162815503558",
  appId: "1:162815503558:web:1238973765bddab360fbc7"
};
// صاحب البرنامج: لازم يكون نفس الإيميل المكتوب في قواعد الأمان (firestore.rules)
const OWNER_EMAIL = "mohamedtahoun363@gmail.com";
// اسم الدخول من غير @ بيتحول لإيميل داخلي
const LOGIN_DOMAIN = "center3m.local";
const OWNER_LOGINS = ["admin", "mohamed", "owner"];
const toEmail = v => { v = (v || "").trim().toLowerCase(); if (OWNER_LOGINS.includes(v)) return OWNER_EMAIL; return v.includes("@") ? v : v + "@" + LOGIN_DOMAIN; };
const showLogin = em => (em || "").endsWith("@" + LOGIN_DOMAIN) ? em.split("@")[0] : em;
const PERMS = [["att", "تسجيل الحضور والإمضاء والإجازات"], ["emps", "إضافة وتعديل الموظفين"], ["pay", "كشف المرتبات والأسعار والسلف والتقارير وقفل الشهر"], ["settings", "الإعدادات (البنود، الحساب، شكل التقارير، مسح الموظفين)"]];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const secApp = initializeApp(firebaseConfig, "secondary");
const secAuth = getAuth(secApp);
const fs = initializeFirestore(app, { ignoreUndefinedProperties: true });
const clone = o => JSON.parse(JSON.stringify(o ?? {}));
const err = e => ({ code: e && e.code === "permission-denied" ? "invalid_argument" : "unavailable", message: e?.message || String(e) });

/* ---------- db adapter: same calls the page already makes ---------- */
const wrapDoc = s => ({ id: s.id, exists: s.exists(), data: () => (s.exists() ? s.data() : undefined) });
const wrapQuery = s => ({ docs: s.docs.map(wrapDoc), size: s.size, empty: s.empty });
function docRef(path) {
  const r = doc(fs, path);
  return {
    id: r.id, path,
    get: async () => { try { return wrapDoc(await getDoc(r)); } catch (e) { throw err(e); } },
    set: async d => { try { await setDoc(r, clone(d)); } catch (e) { throw err(e); } },
    update: async d => { try { await setDoc(r, clone(d), { merge: true }); } catch (e) { throw err(e); } },
    delete: async () => { try { await deleteDoc(r); } catch (e) { throw err(e); } },
    onSnapshot: (next, onErr) => onSnapshot(r, s => next(wrapDoc(s)), e => onErr && onErr(err(e)))
  };
}
function queryRef(path, filters = []) {
  const q = () => query(collection(fs, path), ...filters.map(f => where(f[0], f[1], f[2])));
  return {
    where: (f, op, v) => queryRef(path, [...filters, [f, op, v]]),
    get: async () => { try { return wrapQuery(await getDocs(q())); } catch (e) { throw err(e); } },
    onSnapshot: (next, onErr) => onSnapshot(q(), s => next(wrapQuery(s)), e => onErr && onErr(err(e))),
    doc: id => docRef(path + "/" + id)
  };
}
const db = { doc: docRef, collection: p => queryRef(p) };

/* ---------- downloads: real browser downloads ---------- */
const downloads = {
  save: async ({ filename, data }) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith(".html") ? "text/html;charset=utf-8" : "application/octet-stream" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); return { status: "saved" };
  }
};

/* ---------- people ---------- */
let me = null, myRole = "pending", myPerms = {};
const names = {};
const user = {
  id: async () => me?.uid ?? null,
  isOwner: async () => myRole === "owner",
  canEdit: async () => myRole === "owner",
  can: async () => myRole === "owner" || myRole === "staff",
  perms: async () => (myRole === "owner" ? { att: true, emps: true, pay: true, settings: true } : { ...myPerms }),
  me: async () => ({ id: me?.uid ?? null, name: names[me?.uid] || "", isOwner: myRole === "owner" }),
  profiles: async ids => {
    const out = {};
    await Promise.all([...new Set([].concat(ids))].map(async id => {
      if (names[id] === undefined) { try { const s = await getDoc(doc(fs, "users/" + id)); names[id] = s.exists() ? (s.data().name || s.data().email || "") : ""; } catch { names[id] = ""; } }
      out[id] = { id, name: names[id] || "" };
    }));
    return out;
  }
};

/* ---------- login screen ---------- */
const LOGO = document.querySelector(".brand img")?.src || "icon-192.png";
const css = `
#gate{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:20px;background:radial-gradient(900px 500px at 80% 0%,#1d4a6b,transparent 60%),#0f1e30;font-family:var(--f-body)}
#gate .box{width:min(420px,100%);background:#fff;color:#14233A;border-radius:22px;padding:28px 24px;box-shadow:0 24px 60px rgba(0,0,0,.4);text-align:center}
#gate img{width:84px;height:84px;border-radius:20px}
#gate h1{font:700 1.5rem var(--f-display);margin:12px 0 2px}#gate p{color:#62738A;margin:0 0 16px;font-size:.92rem}
#gate form{display:flex;flex-direction:column;gap:10px;text-align:right}
#gate input{border:1px solid #D6E0EA;border-radius:12px;padding:12px 14px;font:inherit;font-size:1rem}
#gate input:focus{outline:none;border-color:#1BB8DE;box-shadow:0 0 0 3px rgba(27,184,222,.25)}
#gate button{border:0;border-radius:12px;padding:12px;font:700 1rem var(--f-display);cursor:pointer;background:linear-gradient(118deg,#27C6EE,#2FD8BC);color:#06263A}
#gate .link{background:none;color:#0B84A8;font:600 .88rem var(--f-body);padding:4px}
#gate .msg{min-height:1.3em;font-size:.88rem;color:#D03A4B;text-align:center}
#gate .ok{color:#0E8A5C}
.fb-out{border:1px solid rgba(255,255,255,.15);background:transparent;color:var(--side-ink);border-radius:10px;padding:8px 12px;cursor:pointer;text-align:right}
.fb-install{border:0;border-radius:10px;padding:9px 12px;cursor:pointer;font-weight:700;background:linear-gradient(118deg,#27C6EE,#2FD8BC);color:#06263A;text-align:right}
#gate form#myPwForm{margin-top:6px}
.ugrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.ugrid .field{margin:0}
.umsg{font-size:.88rem;color:var(--bad)}.umsg.ok{color:var(--ok)}
.ulist{display:flex;flex-direction:column;gap:12px}
.ucard{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--surface)}
.ucard.pending{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 6%,var(--surface))}
.ucard.disabled{opacity:.7}
.uhead{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.uhead .av{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:700;background:linear-gradient(135deg,hsl(var(--h) 62% 50%),hsl(calc(var(--h) + 35) 58% 42%))}
.uinfo{flex:1;min-width:0;display:flex;flex-direction:column}.uinfo small{color:var(--muted);text-align:right}
.uact{margin-top:10px;gap:6px}
.pwform{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.pwform input{border:1px solid var(--line);border-radius:10px;padding:7px 10px;background:var(--surface);color:var(--ink)}
.danger-txt{color:var(--bad)!important}
`;
document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
let mode = "in";
function gate(html) {
  let g = document.getElementById("gate");
  if (!html) { g && g.remove(); return; }
  if (!g) { g = document.createElement("div"); g.id = "gate"; document.body.appendChild(g); }
  g.innerHTML = `<div class="box"><img src="${LOGO}" alt=""><h1>برنامج المرتبات</h1>${html}</div>`;
}
function loginForm(msg = "", okMsg = false) {
  const up = mode === "up";
  gate(up ? `<p>أول مرة بس: اعمل حساب صاحب البرنامج</p>
   <form id="gForm"><input id="gName" placeholder="اسمك" required autocomplete="name">
   <input id="gEmail" type="text" value="${OWNER_EMAIL}" readonly dir="ltr" style="background:#F2F5F8;color:#62738A">
   <input id="gPass" type="password" placeholder="باسورد جديد (6 على الأقل)" required minlength="6" autocomplete="new-password" dir="ltr">
   <div class="msg ${okMsg ? "ok" : ""}" id="gMsg">${msg}</div>
   <button type="submit">إنشاء حساب صاحب البرنامج</button>
   <button type="button" class="link" id="gSwitch">رجوع لتسجيل الدخول</button></form>`
  : `<p>سجّل دخولك باسم الدخول والباسورد</p>
   <form id="gForm">
   <input id="gEmail" type="text" placeholder="اسم الدخول" required autocomplete="username" dir="ltr" autocapitalize="none">
   <input id="gPass" type="password" placeholder="الباسورد" required autocomplete="current-password" dir="ltr">
   <div class="msg ${okMsg ? "ok" : ""}" id="gMsg">${msg}</div>
   <button type="submit">دخول</button>
   <button type="button" class="link" id="gForgot">نسيت الباسورد</button>
   <button type="button" class="link" id="gSwitch" style="font-size:.75rem;color:#93A4B6">صاحب البرنامج وأول مرة تدخل؟</button></form>`);
}
const arErr = e => ({ "auth/invalid-credential": "اسم الدخول أو الباسورد غلط", "auth/wrong-password": "الباسورد غلط", "auth/user-not-found": "مفيش حساب بالاسم ده", "auth/email-already-in-use": "اسم الدخول ده مستخدم قبل كده، اختار اسم تاني", "auth/weak-password": "الباسورد لازم 6 حروف أو أرقام على الأقل", "auth/invalid-email": "اسم الدخول لازم حروف إنجليزي أو أرقام", "auth/too-many-requests": "محاولات كتير، استنى شوية وجرّب تاني", "auth/network-request-failed": "مفيش إنترنت" }[e?.code] || "حصلت مشكلة، جرّب تاني");
document.addEventListener("submit", async e => {
  if (e.target.id !== "gForm") return; e.preventDefault();
  const email = toEmail(document.getElementById("gEmail").value), pass = document.getElementById("gPass").value, m = document.getElementById("gMsg");
  m.className = "msg"; m.textContent = "لحظة…";
  try {
    if (mode === "up") { pendingName = document.getElementById("gName").value.trim(); const c = await createUserWithEmailAndPassword(auth, OWNER_EMAIL, pass); updateProfile(c.user, { displayName: pendingName }).catch(() => {}); }
    else await signInWithEmailAndPassword(auth, email, pass);
  } catch (x) { m.textContent = arErr(x); }
});
let pendingName = "";
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "gSwitch") { mode = mode === "up" ? "in" : "up"; loginForm(); }
  else if (t.id === "gForgot") { const v = toEmail(document.getElementById("gEmail").value); if (v === OWNER_EMAIL) { try { await sendPasswordResetEmail(auth, OWNER_EMAIL); loginForm("بعتنالك إيميل تغيّر منه الباسورد", true); } catch (x) { document.getElementById("gMsg").textContent = arErr(x); } } else { const m = document.getElementById("gMsg"); m.className = "msg"; m.textContent = "كلّم صاحب البرنامج يغيّرلك الباسورد"; } }
  else if (t.id === "gOut" || t.dataset.logout) { await signOut(auth); location.reload(); }
  else if (t.id === "fbInstall") { if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; t.hidden = true; } else alert("من قايمة المتصفح اختار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»"); }
});

/* ---------- users & permissions (owner, in settings) ---------- */
let usersList = [], uiMsg = "", uiOk = false, pwFor = null;
const permBoxes = (pre, perms, uid) => PERMS.map(([k, t]) => `<label><input type="checkbox" ${uid ? `data-uperm="${k}" data-uid="${uid}"` : `id="${pre}${k}"`} ${perms[k] ? "checked" : ""}> ${t}</label>`).join("");
window.renderUsersPanel = () => {
  if (myRole !== "owner") return "";
  const label = { staff: "مفعّل", pending: "مستني موافقة", disabled: "موقوف" };
  const rows = usersList.filter(u => u.role !== "owner").sort((a, b) => (a.role === "pending" ? 0 : 1) - (b.role === "pending" ? 0 : 1) || (a.name || "").localeCompare(b.name || "", "ar"));
  const card = u => `<div class="ucard ${u.role}">
     <div class="uhead"><span class="av" style="--h:${hueOf(u.id)}">${esc((u.name || "?").charAt(0))}</span>
       <div class="uinfo"><b>${esc(u.name || "بدون اسم")}</b><small dir="ltr">${esc(showLogin(u.email || ""))}</small></div>
       <span class="tag ${u.role === "staff" ? "ok" : "warn"}">${label[u.role] || u.role}</span></div>
     ${u.role === "pending" ? `<p class="hint">عمل الحساب بنفسه. اختار صلاحياته ووافق عليه.</p>` : ""}
     <div class="checks two">${permBoxes("", u.perms || {}, u.id)}</div>
     ${pwFor === u.id ? `<form class="pwform" data-pwuid="${u.id}"><input id="pwOld" type="password" placeholder="الباسورد الحالي" required dir="ltr"><input id="pwNew" type="password" placeholder="الباسورد الجديد" minlength="6" required dir="ltr"><button class="btn sm" type="submit">حفظ</button><button class="btn ghost sm" type="button" data-pwcancel="1">إلغاء</button></form>` : ""}
     <div class="row uact">
       ${u.role === "staff" ? `<button class="btn ghost sm" data-urole="disabled" data-uid="${u.id}">إيقاف الحساب</button>` : `<button class="btn sm" data-urole="staff" data-uid="${u.id}">${u.role === "pending" ? "موافقة" : "تفعيل"}</button>`}
       <button class="btn ghost sm" data-pw="${u.id}">تغيير الباسورد</button>
       <button class="btn ghost sm danger-txt" data-udel="${u.id}">حذف</button></div></div>`;
  return `<div class="scard"><h3>إضافة مستخدم جديد</h3>
    <form id="uForm" class="uform">
      <div class="ugrid"><div class="field"><label for="uName">الاسم</label><input id="uName" required placeholder="مثلاً: سامي"></div>
      <div class="field"><label for="uLogin">اسم الدخول (إنجليزي)</label><input id="uLogin" required dir="ltr" placeholder="sami" autocomplete="off" autocapitalize="none"></div>
      <div class="field"><label for="uPass">الباسورد</label><input id="uPass" required minlength="6" dir="ltr" placeholder="6 حروف أو أرقام على الأقل" autocomplete="new-password"></div></div>
      <p class="hint" style="font-weight:600;color:var(--ink)">الصلاحيات</p>
      <div class="checks two">${permBoxes("np-", { att: true }, null)}</div>
      <div class="row" style="margin-top:10px"><button class="btn" type="submit">إنشاء الحساب</button><span class="umsg ${uiOk ? "ok" : ""}">${esc(uiMsg)}</span></div>
    </form>
    <p class="hint">الموظف بيدخل باسم الدخول والباسورد دول بس، من غير إيميل. ابعتهمله، وهو يقدر يغيّر الباسورد بعد كده من القايمة.</p></div>
   <div class="scard"><h3>المستخدمين (${rows.length})</h3>${rows.length ? `<div class="ulist">${rows.map(card).join("")}</div>` : '<p class="hint">لسه مفيش مستخدمين غيرك.</p>'}</div>`;
};
const flash = (m, good) => { uiMsg = m; uiOk = !!good; window.render(); setTimeout(() => { if (uiMsg === m) { uiMsg = ""; window.render(); } }, 6000); };
document.addEventListener("submit", async e => {
  if (e.target.id === "uForm") {
    e.preventDefault();
    const name = document.getElementById("uName").value.trim(), login = document.getElementById("uLogin").value.trim(), pass = document.getElementById("uPass").value;
    const perms = {}; PERMS.forEach(([k]) => perms[k] = document.getElementById("np-" + k).checked);
    if (!/^[A-Za-z0-9._-]{3,}$/.test(login)) { flash("اسم الدخول لازم 3 حروف إنجليزي أو أرقام على الأقل، من غير مسافات"); return; }
    if (OWNER_LOGINS.includes(login.toLowerCase())) { flash("اسم الدخول ده محجوز لصاحب البرنامج، اختار اسم تاني"); return; }
    const email = toEmail(login);
    if (email === OWNER_EMAIL.toLowerCase()) { flash("ده إيميلك إنت"); return; }
    flash("بيتعمل…", true);
    try {
      const c = await createUserWithEmailAndPassword(secAuth, email, pass);
      await setDoc(doc(fs, "users/" + c.user.uid), { email, name, role: "staff", perms, createdAt: serverTimestamp(), createdBy: me.uid });
      await signOut(secAuth);
      flash("اتعمل حساب " + name + " ✓ · اسم الدخول: " + showLogin(email), true);
    } catch (x) { await signOut(secAuth).catch(() => {}); flash(arErr(x)); }
  } else if (e.target.classList?.contains("pwform")) {
    e.preventDefault();
    const uid = e.target.dataset.pwuid, u = usersList.find(x => x.id === uid);
    try {
      const c = await signInWithEmailAndPassword(secAuth, u.email, document.getElementById("pwOld").value);
      await updatePassword(c.user, document.getElementById("pwNew").value); await signOut(secAuth);
      pwFor = null; flash("اتغيّر باسورد " + (u.name || "") + " ✓", true);
    } catch (x) { await signOut(secAuth).catch(() => {}); flash(arErr(x)); }
  } else if (e.target.id === "myPwForm") {
    e.preventDefault();
    const m = document.getElementById("myPwMsg");
    try { await signInWithEmailAndPassword(secAuth, me.email, document.getElementById("myOld").value); await signOut(secAuth); await updatePassword(auth.currentUser, document.getElementById("myNew").value); m.className = "msg ok"; m.textContent = "اتغيّر الباسورد ✓"; setTimeout(() => gate(null), 1500); }
    catch (x) { await signOut(secAuth).catch(() => {}); m.className = "msg"; m.textContent = arErr(x); }
  }
});
document.addEventListener("change", async e => {
  const t = e.target; if (!t.dataset || !t.dataset.uperm) return;
  try { await setDoc(doc(fs, "users/" + t.dataset.uid), { perms: { [t.dataset.uperm]: t.checked } }, { merge: true }); flash("اتحفظت الصلاحيات ✓", true); } catch (x) { flash(arErr(x)); }
});
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.urole) { await setDoc(doc(fs, "users/" + t.dataset.uid), { role: t.dataset.urole, ...(t.dataset.urole === "staff" ? {} : {}) }, { merge: true }); flash(t.dataset.urole === "staff" ? "الحساب اتفعّل ✓" : "الحساب اتوقف", t.dataset.urole === "staff"); }
  else if (t.dataset.udel) { if (t.dataset.armed) { await deleteDoc(doc(fs, "users/" + t.dataset.udel)); flash("اتحذف المستخدم", true); } else { t.dataset.armed = "1"; t.textContent = "اضغط تاني للتأكيد"; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = "حذف"; } }, 5000); } }
  else if (t.dataset.pw) { pwFor = t.dataset.pw; window.render(); }
  else if (t.dataset.pwcancel) { pwFor = null; window.render(); }
  else if (t.dataset.reset) { try { await sendPasswordResetEmail(auth, t.dataset.reset); flash("اتبعت إيميل تغيير الباسورد ✓", true); } catch (x) { flash(arErr(x)); } }
  else if (t.id === "myPw") { gate(`<p>تغيير الباسورد بتاعك</p><form id="myPwForm"><input id="myOld" type="password" placeholder="الباسورد الحالي" required dir="ltr"><input id="myNew" type="password" placeholder="الباسورد الجديد (6 على الأقل)" minlength="6" required dir="ltr"><div class="msg" id="myPwMsg"></div><button type="submit">حفظ</button><button type="button" class="link" id="myPwClose">رجوع</button></form>`); }
  else if (t.id === "myPwClose") gate(null);
});

/* ---------- import backup (owner, in settings) ---------- */
let impMsg = "", impOk = false, impBusy = false;
window.renderImportPanel = () => {
  if (myRole !== "owner") return "";
  return `<div class="scard"><h3>نقل البيانات من النسخة القديمة</h3>
    <p class="hint">اختار ملف <b dir="ltr">payroll-backup.json</b>. هيتضاف الموظفين، والحضور والانصراف، والسلف، والأسعار والإعدادات. لو الموظف موجود قبل كده هيتحدّث، مش هيتكرر.</p>
    <div class="row" style="margin-top:10px"><label class="btn" for="impFile" ${impBusy ? 'aria-disabled="true"' : ""}>${impBusy ? "بيتنقل…" : "اختار ملف النسخة الاحتياطية"}</label>
    <input id="impFile" type="file" accept=".json,application/json" hidden ${impBusy ? "disabled" : ""}>
    <span class="umsg ${impOk ? "ok" : ""}">${esc(impMsg)}</span></div>
    <p class="hint">الإمضاءات القديمة هتظهر باسمك إنت.</p></div>`;
};
const fixBy = d => { if (d && d.days) for (const r of Object.values(d.days)) { if (r.by) r.by = me.uid; if (r.lby) r.lby = me.uid; } return d; };
document.addEventListener("change", async e => {
  if (e.target.id !== "impFile" || !e.target.files[0]) return;
  const f = e.target.files[0];
  impBusy = true; impOk = true; impMsg = "بيقرا الملف…"; window.render();
  try {
    const j = JSON.parse(await f.text()), C = j.collections || {};
    const order = ["config", "months", "employees", "pay", "att"];
    const all = []; for (const c of order) for (const [id, d] of Object.entries(C[c] || {})) all.push([c, id, c === "att" ? fixBy(d) : d]);
    if (!all.length) throw new Error("الملف ده مفيهوش بيانات");
    let n = 0;
    for (const [c, id, d] of all) { await setDoc(doc(fs, c + "/" + id), clone(d), { merge: true }); n++; if (n % 5 === 0) { impMsg = `اتنقل ${n} من ${all.length}…`; window.render(); } }
    const ne = Object.keys(C.employees || {}).length;
    impMsg = `تم ✓ اتنقل ${ne} موظف وكل الحضور والسلف`; impOk = true;
  } catch (x) { impMsg = x.code ? arErr(x) : ("الملف مش مظبوط: " + (x.message || x)); impOk = false; }
  impBusy = false; e.target.value = ""; window.render();
});

/* ---------- install (PWA) ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; const b = document.getElementById("fbInstall"); if (b) b.hidden = false; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
function sideButtons() {
  const f = document.querySelector(".side-foot"); if (!f || document.getElementById("gOut")) return;
  const standalone = matchMedia("(display-mode: standalone)").matches;
  f.insertAdjacentHTML("afterbegin", `<button class="fb-install" id="fbInstall" ${deferredPrompt && !standalone ? "" : "hidden"}>⬇ تثبيت البرنامج على الجهاز</button>`);
  f.insertAdjacentHTML("beforeend", `<button class="fb-out" id="myPw">تغيير الباسورد</button><button class="fb-out" id="gOut">تسجيل الخروج · ${esc(names[me?.uid] || showLogin(me?.email || ""))}</button>`);
}

/* ---------- auth flow ---------- */
let started = false;
async function afterLogin(u) {
  me = u;
  const ref = doc(fs, "users/" + u.uid);
  let s; try { s = await getDoc(ref); } catch (x) { gate(`<p class="msg">مش قادر أوصل لقاعدة البيانات. اتأكد إن قواعد الأمان اتحطت صح.</p><button id="gOut">تسجيل الخروج</button>`); return; }
  const isOwnerEmail = (u.email || "").toLowerCase() === OWNER_EMAIL.toLowerCase();
  if (!s.exists()) {
    if (!isOwnerEmail) { gate(`<p>الحساب ده مش متسجل في البرنامج. كلّم صاحب البرنامج.</p><button id="gOut">رجوع</button>`); return; }
    await setDoc(ref, { email: u.email, name: pendingName || u.displayName || "", role: "owner", createdAt: serverTimestamp() });
    s = await getDoc(ref);
  }
  myRole = s.data().role; myPerms = s.data().perms || {}; names[u.uid] = s.data().name || showLogin(u.email);
  onSnapshot(ref, d => { const r = d.exists() ? d.data().role : "pending"; const pp = JSON.stringify(d.exists() ? d.data().perms || {} : {}); if (started && (r !== myRole || (myRole === "staff" && pp !== JSON.stringify(myPerms)))) location.reload(); });
  if (myRole !== "owner" && myRole !== "staff") {
    gate(`<p>${myRole === "disabled" ? "حسابك موقوف. كلّم صاحب البرنامج." : "حسابك اتعمل ✓<br>مستني موافقة صاحب البرنامج، وأول ما يوافق الصفحة هتفتح لوحدها."}</p><button id="gOut">تسجيل الخروج</button>`);
    onSnapshot(ref, d => { if (d.exists() && ["staff", "owner"].includes(d.data().role)) location.reload(); });
    return;
  }
  if (myRole === "owner") onSnapshot(collection(fs, "users"), q => { usersList = q.docs.map(d => ({ id: d.id, ...d.data() })); q.docs.forEach(d => names[d.id] = d.data().name || showLogin(d.data().email)); if (typeof S !== "undefined" && S.tab === "set") window.render(); });
  gate(null); started = true;
  window.__fbResolve({ db, user, downloads });
  setTimeout(sideButtons, 300);
}
onAuthStateChanged(auth, u => { if (u) { if (!me) afterLogin(u); } else { me = null; loginForm(); } });
