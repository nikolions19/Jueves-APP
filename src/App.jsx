import { useState, useEffect } from "react";
import { ChefHat, Users, Plus, Check, X, Trash2, Home, Utensils, TrendingUp, AlertCircle, ArrowRight, Receipt, Wallet, Lock, LogOut, Shield } from "lucide-react";
import { supabase, GROUP_PASSWORD, ADMIN_PASSWORD } from "./supabase";

export default function App() {
  // Auth state
  const [authStatus, setAuthStatus] = useState(() => {
    const saved = localStorage.getItem("jueves_auth");
    if (saved === "admin") return "admin";
    if (saved === "group") return "group";
    return null;
  });
  const [passInput, setPassInput] = useState("");
  const [authError, setAuthError] = useState("");

  const [tab, setTab] = useState("cenas");
  const [members, setMembers] = useState([]);
  const [dinners, setDinners] = useState([]);
  const [salons, setSalons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState("");
  const [showNewDinner, setShowNewDinner] = useState(false);
  const [showNewSalon, setShowNewSalon] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [selectedDinner, setSelectedDinner] = useState(null);
  const [selectedSalon, setSelectedSalon] = useState(null);

  const isAdmin = authStatus === "admin";

  const [dinnerForm, setDinnerForm] = useState({
    date: new Date().toISOString().split("T")[0],
    cookId: "",
    expenses: [],
    attendees: [],
    expenseAmount: "",
    expenseMemberId: "",
    expenseNote: "",
  });
  const [salonForm, setSalonForm] = useState({
    month: new Date().toISOString().slice(0, 7),
    expenses: [],
    payers: [],
    expenseAmount: "",
    expenseMemberId: "",
  });

  // Login handler
  const handleLogin = (e) => {
    e.preventDefault();
    if (passInput === ADMIN_PASSWORD) {
      setAuthStatus("admin");
      localStorage.setItem("jueves_auth", "admin");
      setAuthError("");
      setPassInput("");
    } else if (passInput === GROUP_PASSWORD) {
      setAuthStatus("group");
      localStorage.setItem("jueves_auth", "group");
      setAuthError("");
      setPassInput("");
    } else {
      setAuthError("Clave incorrecta");
    }
  };

  const handleLogout = () => {
    if (!confirm("¿Cerrar sesión?")) return;
    localStorage.removeItem("jueves_auth");
    setAuthStatus(null);
  };

  // Load data from Supabase
  const loadData = async () => {
    try {
      const [m, d, s] = await Promise.all([
        supabase.from("members").select("*").order("created_at", { ascending: true }),
        supabase.from("dinners").select("*").order("date", { ascending: false }),
        supabase.from("salons").select("*").order("month", { ascending: false }),
      ]);
      if (m.data) setMembers(m.data);
      if (d.data) setDinners(d.data.map(parseDinner));
      if (s.data) setSalons(s.data.map(parseSalon));
    } catch (e) {
      console.error("Error loading:", e);
    } finally {
      setLoading(false);
    }
  };

  // Parse helpers (Supabase returns snake_case)
  const parseDinner = (d) => ({
    id: d.id,
    date: d.date,
    cookId: d.cook_id,
    expenses: d.expenses || [],
    attendees: d.attendees || [],
    transfers: d.transfers || [],
  });
  const parseSalon = (s) => ({
    id: s.id,
    month: s.month,
    expenses: s.expenses || [],
    payers: s.payers || [],
    transfers: s.transfers || [],
  });

  useEffect(() => {
    if (!authStatus) return;
    loadData();

    // Real-time subscription
    const channel = supabase
      .channel("jueves-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "dinners" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "salons" }, () => loadData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authStatus]);

  const showSync = (msg) => {
    setSyncStatus(msg);
    setTimeout(() => setSyncStatus(""), 2000);
  };

  // Member operations
  const addMember = async () => {
    if (!newMemberName.trim()) return;
    const id = Date.now().toString();
    const { error } = await supabase.from("members").insert({ id, name: newMemberName.trim() });
    if (error) {
      alert("Error al agregar: " + error.message);
      return;
    }
    setNewMemberName("");
    showSync("Miembro agregado");
    loadData();
  };

  const removeMember = async (id) => {
    if (!isAdmin) {
      alert("Solo los admins pueden eliminar miembros");
      return;
    }
    if (!confirm("¿Eliminar este miembro? No afecta registros pasados.")) return;
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    showSync("Miembro eliminado");
    loadData();
  };

  // Settlement calculation
  const calculateSettlements = (expenses, participants) => {
    if (participants.length === 0) return { balances: [], transfers: [], totalCost: 0, perPerson: 0 };
    const totalCost = expenses.reduce((acc, e) => acc + Number(e.amount), 0);
    const perPerson = totalCost / participants.length;
    const balances = participants.map((memberId) => {
      const paid = expenses.filter((e) => e.memberId === memberId).reduce((acc, e) => acc + Number(e.amount), 0);
      return { memberId, paid, owes: perPerson, balance: paid - perPerson };
    });
    const creditors = balances.filter((b) => b.balance > 0.01).map((b) => ({ ...b, remaining: b.balance })).sort((a, b) => b.remaining - a.remaining);
    const debtors = balances.filter((b) => b.balance < -0.01).map((b) => ({ ...b, remaining: -b.balance })).sort((a, b) => b.remaining - a.remaining);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const amount = Math.min(debtor.remaining, creditor.remaining);
      if (amount > 0.01) {
        transfers.push({ from: debtor.memberId, to: creditor.memberId, amount, paid: false });
      }
      debtor.remaining -= amount;
      creditor.remaining -= amount;
      if (debtor.remaining < 0.01) i++;
      if (creditor.remaining < 0.01) j++;
    }
    return { balances, transfers, totalCost, perPerson };
  };

  // Dinner form helpers
  const addExpenseToDinner = () => {
    const amount = parseFloat(dinnerForm.expenseAmount);
    if (!amount || !dinnerForm.expenseMemberId) {
      alert("Completá el monto y quién lo gastó");
      return;
    }
    const newExpense = { id: Date.now().toString(), memberId: dinnerForm.expenseMemberId, amount, note: dinnerForm.expenseNote.trim() };
    setDinnerForm({ ...dinnerForm, expenses: [...dinnerForm.expenses, newExpense], expenseAmount: "", expenseNote: "" });
  };
  const removeExpenseFromDinner = (id) => {
    setDinnerForm({ ...dinnerForm, expenses: dinnerForm.expenses.filter((e) => e.id !== id) });
  };
  const addExpenseToSalon = () => {
    const amount = parseFloat(salonForm.expenseAmount);
    if (!amount || !salonForm.expenseMemberId) {
      alert("Completá el monto y quién lo gastó");
      return;
    }
    const newExpense = { id: Date.now().toString(), memberId: salonForm.expenseMemberId, amount };
    setSalonForm({ ...salonForm, expenses: [...salonForm.expenses, newExpense], expenseAmount: "" });
  };
  const removeExpenseFromSalon = (id) => {
    setSalonForm({ ...salonForm, expenses: salonForm.expenses.filter((e) => e.id !== id) });
  };

  const createDinner = async () => {
    if (!dinnerForm.cookId || dinnerForm.expenses.length === 0 || dinnerForm.attendees.length === 0) {
      alert("Faltan datos: cocinero, al menos un gasto, y asistentes");
      return;
    }
    const { transfers } = calculateSettlements(dinnerForm.expenses, dinnerForm.attendees);
    const id = Date.now().toString();
    const { error } = await supabase.from("dinners").insert({
      id,
      date: dinnerForm.date,
      cook_id: dinnerForm.cookId,
      expenses: dinnerForm.expenses,
      attendees: dinnerForm.attendees,
      transfers,
    });
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    setShowNewDinner(false);
    setDinnerForm({ date: new Date().toISOString().split("T")[0], cookId: "", expenses: [], attendees: [], expenseAmount: "", expenseMemberId: "", expenseNote: "" });
    showSync("Cena registrada");
    loadData();
  };

  const createSalon = async () => {
    if (salonForm.expenses.length === 0 || salonForm.payers.length === 0) {
      alert("Faltan datos: al menos un gasto y los que pagan");
      return;
    }
    const { transfers } = calculateSettlements(salonForm.expenses, salonForm.payers);
    const id = Date.now().toString();
    const { error } = await supabase.from("salons").insert({
      id,
      month: salonForm.month,
      expenses: salonForm.expenses,
      payers: salonForm.payers,
      transfers,
    });
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    setShowNewSalon(false);
    setSalonForm({ month: new Date().toISOString().slice(0, 7), expenses: [], payers: [], expenseAmount: "", expenseMemberId: "" });
    showSync("Salón registrado");
    loadData();
  };

  const toggleTransfer = async (type, recordId, transferIdx, method) => {
    const table = type === "dinner" ? "dinners" : "salons";
    const list = type === "dinner" ? dinners : salons;
    const record = list.find((r) => r.id === recordId);
    if (!record) return;
    const newTransfers = record.transfers.map((t, i) =>
      i === transferIdx ? (t.paid && t.method === method ? { ...t, paid: false, method: null } : { ...t, paid: true, method }) : t
    );
    const { error } = await supabase.from(table).update({ transfers: newTransfers, updated_at: new Date().toISOString() }).eq("id", recordId);
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    if (type === "dinner" && selectedDinner) setSelectedDinner({ ...selectedDinner, transfers: newTransfers });
    if (type === "salon" && selectedSalon) setSelectedSalon({ ...selectedSalon, transfers: newTransfers });
    loadData();
  };

  const deleteRecord = async (type, id) => {
    if (!isAdmin) {
      alert("Solo los admins pueden eliminar registros");
      return;
    }
    if (!confirm("¿Eliminar este registro? No se puede deshacer.")) return;
    const table = type === "dinner" ? "dinners" : "salons";
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    if (type === "dinner") setSelectedDinner(null);
    else setSelectedSalon(null);
    showSync("Registro eliminado");
    loadData();
  };

  const memberName = (id) => members.find((m) => m.id === id)?.name || "—";
  const fmt = (n) => `$${Math.round(n).toLocaleString("es-AR")}`;
  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
  const fmtMonth = (m) => new Date(m + "-01T00:00:00").toLocaleDateString("es-AR", { month: "long", year: "numeric" });

  // LOGIN SCREEN
  if (!authStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center p-5" style={{ background: "#f4ede4" }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 style={{ fontFamily: "Fraunces, Georgia, serif", color: "#1c1917" }} className="text-6xl font-extrabold tracking-tight mb-2">
              Jueves
            </h1>
            <p className="text-sm" style={{ color: "#78716c" }}>La cuenta de los muchachos</p>
          </div>
          <form onSubmit={handleLogin} className="rounded-lg p-5 space-y-3" style={{ background: "#fffaf2", border: "1px solid #d6cfc2" }}>
            <label className="text-xs uppercase tracking-wide block" style={{ color: "#78716c" }}>
              Clave
            </label>
            <input
              type="password"
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              autoFocus
              className="w-full px-3 py-2.5 rounded-md text-base"
              style={{ background: "#fffaf2", border: "1.5px solid #d6cfc2" }}
              placeholder="Ingresá la clave del grupo"
            />
            {authError && (
              <p className="text-sm" style={{ color: "#b54e1f" }}>
                {authError}
              </p>
            )}
            <button type="submit" className="w-full py-3 rounded-md font-medium" style={{ background: "#1c1917", color: "#f4ede4" }}>
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f4ede4" }}>
        <div style={{ color: "#57534e" }}>Cargando...</div>
      </div>
    );
  }

  const stats = {
    cookCount: members.map((m) => ({ ...m, count: dinners.filter((d) => d.cookId === m.id).length })).sort((a, b) => b.count - a.count),
    totalDinners: dinners.length,
    totalSpent: dinners.reduce((acc, d) => acc + d.expenses.reduce((a, e) => a + Number(e.amount), 0), 0) + salons.reduce((acc, s) => acc + s.expenses.reduce((a, e) => a + Number(e.amount), 0), 0),
    pendingDinners: dinners.reduce((acc, d) => acc + d.transfers.filter((t) => !t.paid).length, 0),
    pendingSalons: salons.reduce((acc, s) => acc + s.transfers.filter((t) => !t.paid).length, 0),
  };

  return (
    <div className="min-h-screen pb-24" style={{ background: "#f4ede4" }}>
      <style>{`
        .display { font-family: 'Fraunces', Georgia, serif; }
        .body-font { font-family: 'Inter', sans-serif; }
        .btn-primary { background: #1c1917; color: #f4ede4; transition: all 0.15s ease; }
        .btn-primary:hover { background: #44403c; }
        .btn-secondary { background: transparent; color: #1c1917; border: 1.5px solid #1c1917; transition: all 0.15s ease; }
        .btn-secondary:hover { background: #1c1917; color: #f4ede4; }
        .card { background: #fffaf2; border: 1px solid #d6cfc2; }
        .accent { color: #b54e1f; }
        .tab-active { background: #1c1917; color: #f4ede4; }
        .tab-inactive { background: transparent; color: #57534e; }
        input, select { background: #fffaf2; border: 1.5px solid #d6cfc2; padding: 10px 12px; border-radius: 6px; font-family: 'Inter', sans-serif; width: 100%; }
        input:focus, select:focus { outline: none; border-color: #1c1917; }
        .grain { background-image: radial-gradient(rgba(0,0,0,0.025) 1px, transparent 1px); background-size: 4px 4px; }
        .sync-toast {
          position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
          background: #1c1917; color: #f4ede4; padding: 8px 16px; border-radius: 999px;
          font-size: 13px; z-index: 100; animation: fade 2s ease;
        }
        @keyframes fade { 0% { opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
      `}</style>

      {syncStatus && <div className="sync-toast body-font">{syncStatus}</div>}

      <div className="grain" style={{ borderBottom: "1px solid #d6cfc2" }}>
        <div className="max-w-3xl mx-auto px-5 pt-8 pb-6">
          <div className="flex items-baseline justify-between mb-1">
            <h1 className="display text-4xl font-extrabold tracking-tight" style={{ color: "#1c1917" }}>Jueves</h1>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <span className="body-font text-xs flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: "#1c1917", color: "#f4ede4" }}>
                  <Shield size={10} /> admin
                </span>
              )}
              <button onClick={() => setShowMembers(true)} className="body-font text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-md btn-secondary">
                <Users size={14} /> {members.length}
              </button>
              <button onClick={handleLogout} className="body-font text-sm p-1.5 rounded-md" style={{ color: "#78716c" }} title="Cerrar sesión">
                <LogOut size={14} />
              </button>
            </div>
          </div>
          <p className="body-font text-sm" style={{ color: "#78716c" }}>La cuenta de los muchachos</p>
        </div>

        <div className="max-w-3xl mx-auto px-5 pb-4">
          <div className="flex gap-2">
            {[
              { id: "cenas", label: "Cenas", icon: Utensils },
              { id: "salon", label: "Salón", icon: Home },
              { id: "stats", label: "Resumen", icon: TrendingUp },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} className={`body-font text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 ${tab === t.id ? "tab-active" : "tab-inactive"}`}>
                  <Icon size={14} />{t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 pt-6">
        {members.length === 0 && (
          <div className="card rounded-lg p-5 mb-6 flex gap-3 items-start" style={{ borderColor: "#b54e1f" }}>
            <AlertCircle className="accent flex-shrink-0 mt-0.5" size={20} />
            <div>
              <h3 className="display font-semibold text-lg mb-1" style={{ color: "#1c1917" }}>Cargá los miembros primero</h3>
              <p className="body-font text-sm mb-3" style={{ color: "#57534e" }}>Antes de registrar cenas o el salón, agregá a los muchachos del grupo.</p>
              <button onClick={() => setShowMembers(true)} className="body-font text-sm px-4 py-2 rounded-md btn-primary">Agregar miembros</button>
            </div>
          </div>
        )}

        {tab === "cenas" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="display text-2xl font-semibold" style={{ color: "#1c1917" }}>Cenas semanales</h2>
              {members.length > 0 && (
                <button onClick={() => setShowNewDinner(true)} className="body-font text-sm px-4 py-2 rounded-md btn-primary flex items-center gap-1.5">
                  <Plus size={14} /> Nueva cena
                </button>
              )}
            </div>
            {dinners.length === 0 ? (
              <div className="card rounded-lg p-8 text-center">
                <ChefHat className="mx-auto mb-3" style={{ color: "#a8a29e" }} size={32} />
                <p className="body-font text-sm" style={{ color: "#78716c" }}>No hay cenas registradas todavía.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {dinners.map((d) => {
                  const total = d.expenses.reduce((acc, e) => acc + Number(e.amount), 0);
                  const paid = d.transfers.filter((t) => t.paid).length;
                  const totalT = d.transfers.length;
                  const pct = totalT === 0 ? 100 : (paid / totalT) * 100;
                  return (
                    <button key={d.id} onClick={() => setSelectedDinner(d)} className="card rounded-lg p-4 w-full text-left hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="display text-lg font-semibold" style={{ color: "#1c1917" }}>{fmtDate(d.date)}</div>
                          <div className="body-font text-xs flex items-center gap-1 mt-0.5" style={{ color: "#78716c" }}>
                            <ChefHat size={12} /> {memberName(d.cookId)} · {d.attendees.length} asistentes
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="display text-lg font-semibold" style={{ color: "#1c1917" }}>{fmt(total)}</div>
                          <div className="body-font text-xs" style={{ color: "#78716c" }}>{fmt(total / d.attendees.length)} c/u</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <div className="flex-1 h-1.5 rounded-full" style={{ background: "#e7e0d3" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? "#166534" : "#b54e1f" }} />
                        </div>
                        <span className="body-font text-xs font-medium" style={{ color: "#57534e" }}>{paid}/{totalT}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "salon" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="display text-2xl font-semibold" style={{ color: "#1c1917" }}>Pago del salón</h2>
              {members.length > 0 && (
                <button onClick={() => setShowNewSalon(true)} className="body-font text-sm px-4 py-2 rounded-md btn-primary flex items-center gap-1.5">
                  <Plus size={14} /> Nuevo mes
                </button>
              )}
            </div>
            {salons.length === 0 ? (
              <div className="card rounded-lg p-8 text-center">
                <Home className="mx-auto mb-3" style={{ color: "#a8a29e" }} size={32} />
                <p className="body-font text-sm" style={{ color: "#78716c" }}>No hay meses registrados todavía.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {salons.map((s) => {
                  const total = s.expenses.reduce((acc, e) => acc + Number(e.amount), 0);
                  const paid = s.transfers.filter((t) => t.paid).length;
                  const totalT = s.transfers.length;
                  const pct = totalT === 0 ? 100 : (paid / totalT) * 100;
                  return (
                    <button key={s.id} onClick={() => setSelectedSalon(s)} className="card rounded-lg p-4 w-full text-left hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="display text-lg font-semibold capitalize" style={{ color: "#1c1917" }}>{fmtMonth(s.month)}</div>
                          <div className="body-font text-xs mt-0.5" style={{ color: "#78716c" }}>{s.payers.length} pagan</div>
                        </div>
                        <div className="text-right">
                          <div className="display text-lg font-semibold" style={{ color: "#1c1917" }}>{fmt(total)}</div>
                          <div className="body-font text-xs" style={{ color: "#78716c" }}>{fmt(total / s.payers.length)} c/u</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <div className="flex-1 h-1.5 rounded-full" style={{ background: "#e7e0d3" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? "#166534" : "#b54e1f" }} />
                        </div>
                        <span className="body-font text-xs font-medium" style={{ color: "#57534e" }}>{paid}/{totalT}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "stats" && (
          <div>
            <h2 className="display text-2xl font-semibold mb-4" style={{ color: "#1c1917" }}>Resumen general</h2>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <StatCard label="Cenas" value={stats.totalDinners} />
              <StatCard label="Gastado" value={fmt(stats.totalSpent)} />
              <StatCard label="Pendientes cenas" value={stats.pendingDinners} accent />
              <StatCard label="Pendientes salón" value={stats.pendingSalons} accent />
            </div>
            <h3 className="display text-xl font-semibold mb-3" style={{ color: "#1c1917" }}>Veces que cocinó cada uno</h3>
            <div className="card rounded-lg p-4">
              {stats.cookCount.length === 0 ? (
                <p className="body-font text-sm" style={{ color: "#78716c" }}>Sin datos aún.</p>
              ) : (
                <div className="space-y-2">
                  {stats.cookCount.map((m, i) => (
                    <div key={m.id} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <span className="body-font text-xs w-5" style={{ color: "#a8a29e" }}>{i + 1}.</span>
                        <span className="body-font text-sm font-medium" style={{ color: "#1c1917" }}>{m.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <ChefHat size={12} style={{ color: "#b54e1f" }} />
                        <span className="display font-semibold" style={{ color: "#1c1917" }}>{m.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showMembers && (
        <Modal onClose={() => setShowMembers(false)} title="Miembros del grupo">
          <div className="flex gap-2 mb-4">
            <input value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMember()} placeholder="Nombre" className="body-font flex-1" />
            <button onClick={addMember} className="btn-primary px-4 rounded-md body-font text-sm">Agregar</button>
          </div>
          {members.length === 0 ? (
            <p className="body-font text-sm text-center py-4" style={{ color: "#78716c" }}>Aún no hay miembros.</p>
          ) : (
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-2 rounded-md" style={{ background: "#f4ede4" }}>
                  <span className="body-font text-sm" style={{ color: "#1c1917" }}>{m.name}</span>
                  {isAdmin && (
                    <button onClick={() => removeMember(m.id)} className="p-1" style={{ color: "#b54e1f" }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {showNewDinner && (
        <Modal onClose={() => setShowNewDinner(false)} title="Nueva cena">
          <DinnerForm
            form={dinnerForm} setForm={setDinnerForm}
            members={members} memberName={memberName} fmt={fmt}
            addExpense={addExpenseToDinner} removeExpense={removeExpenseFromDinner}
            calculate={calculateSettlements} onSubmit={createDinner}
          />
        </Modal>
      )}

      {showNewSalon && (
        <Modal onClose={() => setShowNewSalon(false)} title="Nuevo mes de salón">
          <SalonForm
            form={salonForm} setForm={setSalonForm}
            members={members} memberName={memberName} fmt={fmt}
            addExpense={addExpenseToSalon} removeExpense={removeExpenseFromSalon}
            calculate={calculateSettlements} onSubmit={createSalon}
          />
        </Modal>
      )}

      {selectedDinner && (
        <Modal onClose={() => setSelectedDinner(null)} title={fmtDate(selectedDinner.date)}>
          <DetailView record={selectedDinner} participants={selectedDinner.attendees} memberName={memberName} fmt={fmt} cookId={selectedDinner.cookId} calculate={calculateSettlements} onToggleTransfer={(idx, method) => toggleTransfer("dinner", selectedDinner.id, idx, method)} onDelete={() => deleteRecord("dinner", selectedDinner.id)} isAdmin={isAdmin} />
        </Modal>
      )}

      {selectedSalon && (
        <Modal onClose={() => setSelectedSalon(null)} title={fmtMonth(selectedSalon.month)}>
          <DetailView record={selectedSalon} participants={selectedSalon.payers} memberName={memberName} fmt={fmt} calculate={calculateSettlements} onToggleTransfer={(idx, method) => toggleTransfer("salon", selectedSalon.id, idx, method)} onDelete={() => deleteRecord("salon", selectedSalon.id)} isAdmin={isAdmin} />
        </Modal>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="card rounded-lg p-4">
      <div className="body-font text-xs uppercase tracking-wide mb-1" style={{ color: "#78716c" }}>{label}</div>
      <div className={`display text-3xl font-bold ${accent ? "accent" : ""}`} style={{ color: accent ? undefined : "#1c1917" }}>{value}</div>
    </div>
  );
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(28, 25, 23, 0.5)" }} onClick={onClose}>
      <div className="card rounded-t-2xl sm:rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 sticky top-0 z-10" style={{ background: "#fffaf2", borderBottom: "1px solid #d6cfc2" }}>
          <h3 className="display text-xl font-semibold" style={{ color: "#1c1917" }}>{title}</h3>
          <button onClick={onClose} className="p-1" style={{ color: "#78716c" }}><X size={20} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function DinnerForm({ form, setForm, members, memberName, fmt, addExpense, removeExpense, calculate, onSubmit }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="body-font text-xs uppercase tracking-wide mb-1 block" style={{ color: "#78716c" }}>Fecha</label>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="body-font" />
        </div>
        <div>
          <label className="body-font text-xs uppercase tracking-wide mb-1 block" style={{ color: "#78716c" }}>Cocinó</label>
          <select value={form.cookId} onChange={(e) => setForm({ ...form, cookId: e.target.value })} className="body-font">
            <option value="">Elegir...</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      <ExpenseSection form={form} setForm={setForm} members={members} memberName={memberName} fmt={fmt} addExpense={addExpense} removeExpense={removeExpense} hasNote={true} />

      <div className="pt-2">
        <label className="body-font text-xs uppercase tracking-wide mb-1 block" style={{ color: "#78716c" }}>Asistentes ({form.attendees.length})</label>
        <ParticipantSelector members={members} selected={form.attendees} onChange={(next) => setForm({ ...form, attendees: next })} />
      </div>

      {form.expenses.length > 0 && form.attendees.length > 0 && (
        <SettlementPreview expenses={form.expenses} participants={form.attendees} memberName={memberName} fmt={fmt} calculate={calculate} />
      )}

      <button onClick={onSubmit} className="w-full btn-primary py-3 rounded-md body-font font-medium">Registrar cena</button>
    </div>
  );
}

function SalonForm({ form, setForm, members, memberName, fmt, addExpense, removeExpense, calculate, onSubmit }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="body-font text-xs uppercase tracking-wide mb-1 block" style={{ color: "#78716c" }}>Mes</label>
        <input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} className="body-font" />
      </div>

      <ExpenseSection form={form} setForm={setForm} members={members} memberName={memberName} fmt={fmt} addExpense={addExpense} removeExpense={removeExpense} hasNote={false} label="Quién pagó (puede ser uno solo o varios)" />

      <div className="pt-2">
        <label className="body-font text-xs uppercase tracking-wide mb-1 block" style={{ color: "#78716c" }}>Quiénes pagan este mes ({form.payers.length})</label>
        <p className="body-font text-xs mb-2" style={{ color: "#78716c" }}>Solo los que están. El que está afuera no entra.</p>
        <ParticipantSelector members={members} selected={form.payers} onChange={(next) => setForm({ ...form, payers: next })} />
      </div>

      {form.expenses.length > 0 && form.payers.length > 0 && (
        <SettlementPreview expenses={form.expenses} participants={form.payers} memberName={memberName} fmt={fmt} calculate={calculate} />
      )}

      <button onClick={onSubmit} className="w-full btn-primary py-3 rounded-md body-font font-medium">Registrar mes</button>
    </div>
  );
}

function ExpenseSection({ form, setForm, members, memberName, fmt, addExpense, removeExpense, hasNote, label = "Gastos / tickets" }) {
  return (
    <div className="pt-2">
      <label className="body-font text-xs uppercase tracking-wide mb-2 block" style={{ color: "#78716c" }}>{label}</label>
      <div className="grid grid-cols-12 gap-1.5 mb-2">
        <select value={form.expenseMemberId} onChange={(e) => setForm({ ...form, expenseMemberId: e.target.value })} className="body-font col-span-5 text-sm" style={{ padding: "8px" }}>
          <option value="">Quién</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input type="number" inputMode="decimal" value={form.expenseAmount} onChange={(e) => setForm({ ...form, expenseAmount: e.target.value })} placeholder="$" className="body-font col-span-4 text-sm" style={{ padding: "8px" }} />
        <button onClick={addExpense} className="btn-primary col-span-3 rounded-md body-font text-xs flex items-center justify-center gap-1">
          <Plus size={12} /> Sumar
        </button>
      </div>
      {hasNote && (
        <input type="text" value={form.expenseNote} onChange={(e) => setForm({ ...form, expenseNote: e.target.value })} placeholder="Nota opcional (carne, vino, leña...)" className="body-font text-sm mb-2" style={{ padding: "8px" }} />
      )}
      {form.expenses.length > 0 && (
        <div className="space-y-1 p-2 rounded-md" style={{ background: "#f4ede4" }}>
          {form.expenses.map((e) => (
            <div key={e.id} className="flex items-center justify-between py-1 px-2 text-sm">
              <div className="flex-1 min-w-0">
                <span className="body-font font-medium" style={{ color: "#1c1917" }}>{memberName(e.memberId)}</span>
                {e.note && <span className="body-font ml-2 text-xs" style={{ color: "#78716c" }}>{e.note}</span>}
              </div>
              <span className="display font-semibold mr-2" style={{ color: "#1c1917" }}>{fmt(e.amount)}</span>
              <button onClick={() => removeExpense(e.id)} style={{ color: "#b54e1f" }}><X size={14} /></button>
            </div>
          ))}
          <div className="flex items-center justify-between py-2 px-2 mt-1" style={{ borderTop: "1px solid #d6cfc2" }}>
            <span className="body-font text-xs uppercase tracking-wide" style={{ color: "#78716c" }}>Total</span>
            <span className="display text-lg font-bold" style={{ color: "#b54e1f" }}>{fmt(form.expenses.reduce((acc, e) => acc + Number(e.amount), 0))}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ParticipantSelector({ members, selected, onChange }) {
  return (
    <>
      <div className="flex gap-2 mb-2">
        <button onClick={() => onChange(members.map((m) => m.id))} className="body-font text-xs px-2 py-1 rounded btn-secondary">Todos</button>
        <button onClick={() => onChange([])} className="body-font text-xs px-2 py-1 rounded btn-secondary">Ninguno</button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
        {members.map((m) => {
          const checked = selected.includes(m.id);
          return (
            <button key={m.id} onClick={() => {
              const next = checked ? selected.filter((id) => id !== m.id) : [...selected, m.id];
              onChange(next);
            }} className={`body-font text-sm p-2 rounded-md flex items-center gap-1.5 ${checked ? "btn-primary" : "btn-secondary"}`}>
              {checked && <Check size={12} />}{m.name}
            </button>
          );
        })}
      </div>
    </>
  );
}

function SettlementPreview({ expenses, participants, memberName, fmt, calculate }) {
  const { balances, transfers, totalCost, perPerson } = calculate(expenses, participants);
  return (
    <div className="p-3 rounded-md space-y-3" style={{ background: "#f4ede4" }}>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div>
          <div className="body-font text-xs uppercase tracking-wide" style={{ color: "#78716c" }}>Total</div>
          <div className="display text-xl font-bold" style={{ color: "#1c1917" }}>{fmt(totalCost)}</div>
        </div>
        <div>
          <div className="body-font text-xs uppercase tracking-wide" style={{ color: "#78716c" }}>C/u paga</div>
          <div className="display text-xl font-bold accent">{fmt(perPerson)}</div>
        </div>
      </div>
      {balances.some((b) => Math.abs(b.balance) > 0.01) && (
        <div>
          <div className="body-font text-xs uppercase tracking-wide mb-1" style={{ color: "#78716c" }}>Saldos</div>
          <div className="space-y-0.5">
            {balances.filter((b) => Math.abs(b.balance) > 0.01).sort((a, b) => b.balance - a.balance).map((b) => (
              <div key={b.memberId} className="flex justify-between text-sm body-font">
                <span style={{ color: "#1c1917" }}>{memberName(b.memberId)}</span>
                <span className="font-semibold" style={{ color: b.balance > 0 ? "#166534" : "#b54e1f" }}>
                  {b.balance > 0 ? "le devuelven " : "debe "}{fmt(Math.abs(b.balance))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {transfers.length > 0 && (
        <div>
          <div className="body-font text-xs uppercase tracking-wide mb-1" style={{ color: "#78716c" }}>Transferencias sugeridas</div>
          <div className="space-y-1">
            {transfers.map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm body-font p-2 rounded" style={{ background: "#fffaf2" }}>
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span style={{ color: "#1c1917" }}>{memberName(t.from)}</span>
                  <ArrowRight size={12} style={{ color: "#a8a29e" }} />
                  <span style={{ color: "#1c1917" }}>{memberName(t.to)}</span>
                </div>
                <span className="font-semibold" style={{ color: "#b54e1f" }}>{fmt(t.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailView({ record, participants, memberName, fmt, cookId, calculate, onToggleTransfer, onDelete, isAdmin }) {
  const { balances, totalCost, perPerson } = calculate(record.expenses, participants);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center pb-3" style={{ borderBottom: "1px solid #d6cfc2" }}>
        {cookId ? (
          <div>
            <div className="body-font text-xs uppercase tracking-wide" style={{ color: "#78716c" }}>Cocinó</div>
            <div className="body-font font-semibold mt-1 text-sm" style={{ color: "#1c1917" }}>{memberName(cookId)}</div>
          </div>
        ) : <div />}
        <div>
          <div className="body-font text-xs uppercase tracking-wide" style={{ color: "#78716c" }}>Total</div>
          <div className="display font-bold mt-1" style={{ color: "#1c1917" }}>{fmt(totalCost)}</div>
        </div>
        <div>
          <div className="body-font text-xs uppercase tracking-wide" style={{ color: "#78716c" }}>C/u</div>
          <div className="display font-bold mt-1 accent">{fmt(perPerson)}</div>
        </div>
      </div>

      <div>
        <div className="body-font text-xs uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: "#78716c" }}>
          <Receipt size={12} /> Gastos cargados
        </div>
        <div className="space-y-1">
          {record.expenses.map((e) => (
            <div key={e.id} className="flex items-center justify-between p-2 rounded text-sm body-font" style={{ background: "#f4ede4" }}>
              <div className="flex-1 min-w-0">
                <span className="font-medium" style={{ color: "#1c1917" }}>{memberName(e.memberId)}</span>
                {e.note && <span className="ml-2 text-xs" style={{ color: "#78716c" }}>{e.note}</span>}
              </div>
              <span className="display font-semibold" style={{ color: "#1c1917" }}>{fmt(e.amount)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="body-font text-xs uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: "#78716c" }}>
          <Wallet size={12} /> Saldos
        </div>
        <div className="space-y-1">
          {balances.sort((a, b) => b.balance - a.balance).map((b) => (
            <div key={b.memberId} className="flex items-center justify-between p-2 rounded text-sm body-font" style={{ background: "#fffaf2", border: "1px solid #d6cfc2" }}>
              <span className="font-medium" style={{ color: "#1c1917" }}>{memberName(b.memberId)}</span>
              <div className="text-right">
                {Math.abs(b.balance) < 0.01 ? (
                  <span className="text-xs" style={{ color: "#a8a29e" }}>saldado</span>
                ) : (
                  <span className="font-semibold" style={{ color: b.balance > 0 ? "#166534" : "#b54e1f" }}>
                    {b.balance > 0 ? "+" : ""}{fmt(b.balance)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {record.transfers.length > 0 && (
        <div>
          <div className="body-font text-xs uppercase tracking-wide mb-2" style={{ color: "#78716c" }}>
            Transferencias a saldar ({record.transfers.filter((t) => t.paid).length}/{record.transfers.length})
          </div>
          <div className="space-y-2">
            {record.transfers.map((t, i) => (
              <div key={i} className="rounded-md p-3" style={{ background: t.paid ? "#ecfccb" : "#f4ede4" }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 body-font text-sm flex-1 min-w-0">
                    <span className="font-medium" style={{ color: "#1c1917" }}>{memberName(t.from)}</span>
                    <ArrowRight size={12} style={{ color: "#a8a29e" }} />
                    <span className="font-medium" style={{ color: "#1c1917" }}>{memberName(t.to)}</span>
                  </div>
                  <span className="display font-bold" style={{ color: "#1c1917" }}>{fmt(t.amount)}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => onToggleTransfer(i, "efectivo")} className={`body-font text-xs py-1.5 rounded ${t.paid && t.method === "efectivo" ? "btn-primary" : "btn-secondary"}`}>
                    Efectivo
                  </button>
                  <button onClick={() => onToggleTransfer(i, "transferencia")} className={`body-font text-xs py-1.5 rounded ${t.paid && t.method === "transferencia" ? "btn-primary" : "btn-secondary"}`}>
                    Transferencia
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <button onClick={onDelete} className="w-full body-font text-sm py-2 rounded-md flex items-center justify-center gap-1.5" style={{ color: "#b54e1f", border: "1px solid #d6cfc2" }}>
          <Trash2 size={12} /> Eliminar registro (admin)
        </button>
      )}
    </div>
  );
}
