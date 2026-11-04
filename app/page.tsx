"use client";
import { useCallback, useEffect, useState } from "react";
import { DateTime } from "luxon";
import {
  Home,
  Users,
  Network,
  CalendarDays,
  ListTodo,
  Search,
  Plus,
  ChevronLeft,
  Bell,
  Flower2,
  Phone,
  MessageSquare,
  Gift,
  Video,
  Check,
  Clock,
  Settings,
  Link2,
  UserPlus,
  LogOut,
  Pencil,
  Archive,
  RefreshCw,
  X,
  Upload,
  Mail,
  Building2,
  MapPin,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster, toast } from "sonner";
import {
  api,
  setCsrf,
  fa,
  contactAge,
  labels,
  APIError,
  type Person,
  type Action,
  type User,
} from "@/lib/client";
import { faDate } from "@/lib/calendar";
import { Avatar, Busy, Empty, ErrorBox } from "@/components/workspace/common";
import { Graph } from "@/components/workspace/graph";
import { CalendarView } from "@/components/workspace/calendar";
import {
  WorkflowModal,
  type Workflow,
} from "@/components/workspace/workflow-modal";
import { SettingsView } from "@/components/workspace/settings";
const nav = [
  { id: "home", label: "خانه", icon: Home },
  { id: "people", label: "افراد", icon: Users },
  { id: "network", label: "شبکه روابط", icon: Network },
  { id: "calendar", label: "تقویم", icon: CalendarDays },
  { id: "actions", label: "اقدامات", icon: ListTodo },
];
const iconFor = (type: string) =>
  type === "flower"
    ? Flower2
    : type === "call"
      ? Phone
      : type === "meeting"
        ? Video
        : type === "gift"
          ? Gift
          : MessageSquare;
function AppSidebar({
  view,
  go,
  count,
  user,
  onLogout,
}: {
  view: string;
  go: (s: string) => void;
  count: number;
  user: User;
  onLogout: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  const navigate = (v: string) => {
    go(v);
    setOpenMobile(false);
  };
  return (
    <Sidebar side="right" className="app-sidebar">
      <SidebarHeader>
        <div className="brand">
          <span className="brand-symbol">
            <Network size={23} />
          </span>
          <div>
            <strong dir="ltr">
              Relationship<span> OS</span>
            </strong>
            <small>فضای شخصی روابط شما</small>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <div className="space-label">فضای کاری</div>
        <SidebarMenu>
          {nav.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                isActive={view === item.id}
                onClick={() => navigate(item.id)}
                className="nav-button"
              >
                <item.icon size={20} />
                <span>{item.label}</span>
                {item.id === "actions" && <b>{fa(count)}</b>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <div className="sidebar-tip">
          <span className="tiny-icon">
            <Link2 size={19} />
          </span>
          <strong>یک ارتباط کوچک، یک فرصت تازه</strong>
          <p>برای کسی که مدتی از او بی‌خبرید، وقت بگذارید.</p>
          <button onClick={() => navigate("people")}>
            سر زدن به افراد <ChevronLeft size={16} />
          </button>
        </div>
      </SidebarContent>
      <SidebarFooter>
        <button
          className={
            "settings-link " + (view === "settings" ? "is-active" : "")
          }
          onClick={() => navigate("settings")}
        >
          <Settings size={18} />
          تنظیمات و ورود اطلاعات
        </button>
        <div className="side-user">
          <span className="self-avatar">{user.display_name[0]}</span>
          <div>
            <strong>{user.display_name}</strong>
            <small>فضای شخصی شما</small>
          </div>
          <button
            className="user-chevron"
            onClick={onLogout}
            aria-label="خروج از حساب"
          >
            <LogOut size={17} />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page" dir="rtl">
      <div className="login-art">
        <Network size={58} />
        <span dir="ltr">RELATIONSHIP OS</span>
        <h1>
          آدم‌ها را به خاطر بسپارید.
          <br />
          رابطه‌ها را زنده نگه دارید.
        </h1>
        <p>فضای شخصی برای شبکه آشنایی‌ها، روزهای مهم و قدم‌های کوچک بعدی.</p>
        <div className="login-orbit" />
      </div>
      <section className="login-form">
        <span className="brand-symbol">
          <Network size={25} />
        </span>
        <h2>به فضای روابط خوش آمدید</h2>
        <p className="muted">برای دسترسی به شبکه شخصی خود وارد شوید.</p>
        <ErrorBox error={error} />
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const data = Object.fromEntries(new FormData(e.currentTarget));
            try {
              await api("auth/login", "POST", data);
              onLogin();
            } catch (e) {
              setError(e as Error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            ایمیل
            <input
              name="email"
              type="email"
              dir="ltr"
              required
              autoComplete="username"
              autoFocus
            />
          </label>
          <label>
            رمز عبور
            <input
              name="password"
              type="password"
              dir="ltr"
              required
              autoComplete="current-password"
            />
          </label>
          <button className="primary full" disabled={busy}>
            {busy ? "در حال ورود…" : "ورود به فضای من"}
            <ChevronLeft size={17} />
          </button>
        </form>
        <small className="login-note">
          اطلاعات شبکه شما فقط در حساب خودتان در دسترس است.
        </small>
      </section>
    </main>
  );
}
export default function Page() {
  const [user, setUser] = useState<User | null | undefined>(undefined),
    [view, setView] = useState("home"),
    [revision, setRevision] = useState(0),
    [dashboard, setDashboard] = useState<any>(null),
    [days, setDays] = useState(1),
    [query, setQuery] = useState(""),
    [importance, setImportance] = useState("all"),
    [tag, setTag] = useState(""),
    [tags, setTags] = useState<any[]>([]),
    [people, setPeople] = useState<Person[]>([]),
    [peopleCursor, setPeopleCursor] = useState<string | null>(null),
    [peopleLoading, setPeopleLoading] = useState(false),
    [archived, setArchived] = useState(false);
  const [taskFilter, setTaskFilter] = useState("pending"),
    [tasks, setTasks] = useState<Action[]>([]),
    [taskCursor, setTaskCursor] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [profile, setProfile] = useState<any>(null),
    [profileTab, setProfileTab] = useState("overview"),
    [workflow, setWorkflow] = useState<Workflow | null>(null),
    [notifications, setNotifications] = useState<any[]>([]),
    [notifyOpen, setNotifyOpen] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [busyAction, setBusyAction] = useState<string | null>(null);
  const changed = () => setRevision((v) => v + 1);
  const loadUser = useCallback(async () => {
    try {
      const u = await api<User>("auth/me");
      setCsrf(u.csrf_token);
      setUser(u);
    } catch (e) {
      if ((e as APIError).code === "UNAUTHENTICATED") {
        setUser(null);
        setCsrf("");
      } else setError(e as Error);
    }
  }, []);
  useEffect(() => {
    loadUser();
  }, [loadUser]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    Promise.all([
      api("dashboard?days=" + days),
      api("notifications"),
      api("tags"),
    ])
      .then(([d, n, t]) => {
        if (alive) {
          setDashboard(d);
          setNotifications(n.items);
          setTags(t.items);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [user?.id, revision, days]);
  useEffect(() => {
    if (!user || view !== "people") return;
    let alive = true;
    setPeopleLoading(true);
    const timer = setTimeout(() => {
      api(
        "people?" +
          new URLSearchParams({
            q: query,
            importance,
            active: String(!archived),
            limit: "30",
            ...(tag ? { tag } : {}),
          }),
      )
        .then((d) => {
          if (alive) {
            setPeople(d.items);
            setPeopleCursor(d.next_cursor);
            setError(null);
          }
        })
        .catch((e) => alive && setError(e))
        .finally(() => alive && setPeopleLoading(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [user?.id, view, query, importance, tag, archived, revision]);
  useEffect(() => {
    if (!user || view !== "actions") return;
    let alive = true;
    api(
      "actions?limit=30" +
        (taskFilter === "all" ? "" : "&status=" + taskFilter),
    )
      .then((d) => {
        if (alive) {
          setTasks(d.items);
          setTaskCursor(d.next_cursor);
        }
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [user?.id, view, taskFilter, revision]);
  useEffect(() => {
    if (!selectedId || !user) {
      setProfile(null);
      return;
    }
    let alive = true;
    setProfile(null);
    Promise.all([
      api("people/" + selectedId),
      api("people/" + selectedId + "/relationships"),
      api("people/" + selectedId + "/introduction-path"),
      api("important-dates?person_id=" + selectedId),
      api("actions?limit=100&person_id=" + selectedId),
      api("people/" + selectedId + "/timeline"),
    ])
      .then(([p, r, path, d, a, t]) => {
        if (alive)
          setProfile({
            person: p,
            relationships: r.items,
            path,
            dates: d.items,
            actions: a.items,
            timeline: t.items,
            timeline_cursor: t.next_cursor,
          });
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [selectedId, user?.id, revision]);
  const go = (v: string) => {
    window.scrollTo({top:0});
    setView(v);
    setError(null);
    setQuery("");
    setTag("");
  };
  const openPerson = (id: string) => {
    setSelectedId(id);
    setProfileTab("overview");
  };
  const flower = async (id: string, event?: any) => {
    try {
      const p = await api<Person>("people/" + id);
      setWorkflow({ type: "flower", person: p, event });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const editAction = async (a: Action) => {
    try {
      const [record, p] = await Promise.all([
        api("actions/" + a.id),
        api("people/" + a.person_id),
      ]);
      setWorkflow({
        type: a.action_type === "flower" ? "flower" : "action",
        record,
        person: p,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const actionTransition = async (a: Action, status: "complete" | "cancel") => {
    setBusyAction(a.id);
    try {
      const result = await api("actions/" + a.id + "/" + status, "POST", {
        completed_at: new Date().toISOString(),
      });
      toast.success(
        status === "complete"
          ? "اقدام انجام شد و در تاریخچه ثبت شد."
          : "اقدام لغو شد.",
      );
      if (result.warning) toast.warning(result.warning);
      changed();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyAction(null);
    }
  };
  const taskRows = (list: Action[]) =>
    list.length ? (
      list
        .slice()
        .sort((a, b) => a.due_at.localeCompare(b.due_at))
        .map((a) => {
          const Icon = iconFor(a.action_type);
          return (
            <div
              className={`task-row ${a.status === "done" ? "completed" : ""}`}
              key={a.id}
            >
              <button
                disabled={a.status !== "pending" || busyAction === a.id}
                className="action-check"
                aria-label={"انجام " + a.title}
                onClick={() => actionTransition(a, "complete")}
              >
                {a.status === "done" && <Check size={14} />}
              </button>
              <span className={"task-icon " + a.action_type}>
                <Icon size={18} />
              </span>
              <button
                className="task-text"
                onClick={() => openPerson(a.person_id)}
              >
                <strong>{a.title}</strong>
                <small>
                  {a.person_name} ·{" "}
                  {faDate(a.due_at, { hour: "2-digit", minute: "2-digit" })}
                  {a.status === "pending" &&
                    new Date(a.due_at) < new Date() && (
                      <b className="overdue-label"> · عقب‌افتاده</b>
                    )}
                  {a.sms_state && (
                    <span className="sms-state">
                      {" "}
                      · {labels[a.sms_state] ?? a.sms_state}
                    </span>
                  )}
                </small>
              </button>
              <span className={"status-badge " + a.status}>
                {labels[a.status]}
              </span>
              {a.status === "pending" && (
                <div className="row-actions">
                  {a.action_type === "flower" && (
                    <button
                      aria-label={"پیش‌نمایش پیام " + a.title}
                      className="icon-button"
                      onClick={() => setWorkflow({ type: "sms", record: a })}
                    >
                      <MessageSquare size={16} />
                    </button>
                  )}
                  <button
                    aria-label={"ویرایش " + a.title}
                    className="icon-button"
                    onClick={() => editAction(a)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    aria-label={"لغو " + a.title}
                    disabled={busyAction === a.id}
                    className="icon-button"
                    onClick={() => actionTransition(a, "cancel")}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
          );
        })
    ) : (
      <Empty title="کاری در این فهرست نیست">
        <p>برای یک ارتباط تازه، اقدام جدید ثبت کنید.</p>
      </Empty>
    );
  const logout = async () => {
    try {
      await api("auth/logout", "POST", {});
      setUser(null);
      setSelectedId(null);
      setDashboard(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const saved = async (result: any) => {
    const type = workflow?.type;
    if (result?.reload && workflow) {
      try {
        const fresh =
          workflow.type === "person"
            ? { person: await api("people/" + workflow.person?.id) }
            : workflow.type === "action" || workflow.type === "flower"
              ? { record: await api("actions/" + workflow.record.id) }
              : workflow.type === "florist"
                ? {
                    record: (await api("florists")).items.find(
                      (r: any) => r.id === workflow.record.id,
                    ),
                  }
                : workflow.type === "relationship"
                  ? {
                      record: (await api("relationships")).items.find(
                        (r: any) => r.id === workflow.record.id,
                      ),
                    }
                  : {
                      record: (await api("important-dates")).items.find(
                        (r: any) => r.id === workflow.record.id,
                      ),
                    };
        setWorkflow({ ...workflow, ...fresh });
      } catch (e) {
        toast.error((e as Error).message);
      }
      return;
    }
    if (result?.openFlower) {
      setWorkflow(null);
      if (result.person_id) await flower(result.person_id);
      else setWorkflow({ type: "flower" });
      return;
    }
    setWorkflow(null);
    changed();
    toast.success("اطلاعات ذخیره شد.");
    if (type === "password") {
      setUser(null);
      setSelectedId(null);
      return;
    }
    if (type === "archive") setSelectedId(null);
    if (type === "person" && result?.id) openPerson(result.id);
    if (view === "settings") loadUser();
  };
  if (user === undefined)
    return (
      <div className="initial-loading">
        <ErrorBox error={error} />
        {error ? (
          <button className="primary" onClick={loadUser}>
            تلاش دوباره
          </button>
        ) : (
          <Busy />
        )}
      </div>
    );
  if (user === null)
    return (
      <>
        <Login onLogin={loadUser} />
        <Toaster position="bottom-left" dir="rtl" richColors />
      </>
    );
  const heading = (
    title: string,
    description: string,
    eyebrow: string,
    button?: React.ReactNode,
  ) => (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>
          {title}
          <span className="heading-dot">.</span>
        </h1>
        <p>{description}</p>
      </div>
      {button}
    </div>
  );
  const p: Person | undefined = profile?.person;
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "248px" } as React.CSSProperties}
      dir="rtl"
    >
      <AppSidebar
        view={view}
        go={go}
        count={dashboard?.stats.pending ?? 0}
        user={user}
        onLogout={logout}
      />
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger className="mobile-menu" />
            <span>فضای شخصی</span>
            <ChevronLeft size={14} />
            <strong>
              {nav.find((n) => n.id === view)?.label ?? "تنظیمات"}
            </strong>
          </div>
          <div className="top-actions">
            <div className="global-search">
              <Search size={18} />
              <input
                aria-label="جست‌وجوی افراد"
                placeholder="جست‌وجو در روابط شما…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setView("people");
                }}
              />
            </div>
            <button
              className="bell-button"
              onClick={() => setNotifyOpen(true)}
              aria-label="اعلان‌ها"
            >
              <Bell size={20} />
              {notifications.some((n) => !n.read_at) && <i />}
            </button>
            <div className="top-avatar">{user.display_name[0]}</div>
          </div>
        </header>
        <div className="content">
          <div className="demo-label">
            <span className="demo-dot" />
            فضای شخصی{" "}
            <span className="demo-detail">
              {user.sms_mode === "sandbox"
                ? "پیامک آزمایشی فعال است؛ اطلاعات شما ذخیره می‌شوند."
                : "شبکه روابط شما"}
            </span>
            <button
              className="refresh-workspace"
              aria-label="بازخوانی اطلاعات"
              onClick={changed}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <ErrorBox error={error} />
          {view === "home" && (
            <>
              {heading(
                "نگاهی به امروز",
                dashboard
                  ? `${fa(dashboard.stats.pending)} اقدام در انتظار و ${fa(dashboard.stats.overdue)} اقدام عقب‌افتاده دارید.`
                  : "برنامه پیگیری ارتباط‌های شما",
                faDate(new Date(), { weekday: "long", year: "numeric" }),
                <button
                  className="primary"
                  onClick={() => setWorkflow({ type: "person" })}
                >
                  <Plus size={18} />
                  افزودن فرد
                </button>,
              )}
              {!dashboard ? (
                <Busy />
              ) : (
                <>
                  <div className="stats-row">
                    {[
                      {
                        label: "افراد شبکه",
                        number: dashboard.stats.people,
                        icon: Users,
                        detail: "آدم‌هایی که می‌شناسید",
                        c: "blue",
                      },
                      {
                        label: "ارتباط‌های مشترک",
                        number: dashboard.stats.relationships,
                        icon: Network,
                        detail: "هر رابطه، یک مسیر تازه",
                        c: "purple",
                      },
                      {
                        label: "روابط بسیار مهم",
                        number: dashboard.stats.important,
                        icon: Link2,
                        detail: "افراد با اولویت A",
                        c: "orange",
                      },
                      {
                        label: "اقدام در انتظار",
                        number: dashboard.stats.pending,
                        icon: Clock,
                        detail: fa(dashboard.stats.expertise) + " تخصص در شبکه",
                        c: "teal",
                      },
                    ].map((s) => (
                      <div className="stat" key={s.label}>
                        <span className={"stat-icon " + s.c}>
                          <s.icon size={20} />
                        </span>
                        <div>
                          <span>{s.label}</span>
                          <strong>{fa(s.number).padStart(2, "۰")}</strong>
                          <small>{s.detail}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="window-filters">
                    {[
                      [1, "امروز"],
                      [7, "۷ روز آینده"],
                      [30, "۳۰ روز آینده"],
                    ].map(([n, label]) => (
                      <button
                        key={n}
                        className={days === n ? "active" : ""}
                        onClick={() => setDays(Number(n))}
                      >
                        {label}
                      </button>
                    ))}
                    <span>زمان‌ها به وقت {user.timezone}</span>
                  </div>
                  <div className="dashboard-grid">
                    <div className="main-column">
                      <section className="panel today-panel">
                        <div className="section-head">
                          <h2>
                            قرارهای کوچک {days === 1 ? "امروز" : "پیش رو"}{" "}
                            <span className="counter">
                              {fa(dashboard.tasks.length)}
                            </span>
                          </h2>
                          <button
                            className="text-button"
                            onClick={() => go("actions")}
                          >
                            همه اقدامات <ChevronLeft size={16} />
                          </button>
                        </div>
                        <div className="date-strip">
                          <CalendarDays size={17} />
                          <span>{faDate(new Date())}</span>
                          <span className="strip-status">
                            {fa(dashboard.stats.overdue)} عقب‌افتاده
                          </span>
                        </div>
                        <div className="task-list">
                          {taskRows(dashboard.tasks)}
                        </div>
                        <button
                          className="add-inline"
                          onClick={() => setWorkflow({ type: "action" })}
                        >
                          <Plus size={17} />
                          ثبت یک اقدام جدید
                        </button>
                      </section>
                      <section className="panel people-highlight">
                        <div className="section-head">
                          <h2>وقت تازه‌کردن ارتباط</h2>
                          <button
                            className="text-button"
                            onClick={() => go("people")}
                          >
                            همه افراد <ChevronLeft size={16} />
                          </button>
                        </div>
                        <div className="reconnect-list">
                          {dashboard.reconnect.length ? (
                            dashboard.reconnect.map((person: Person) => (
                              <button
                                key={person.id}
                                className="reconnect-person"
                                onClick={() => openPerson(person.id)}
                              >
                                <Avatar p={person} />
                                <strong>{person.display_name}</strong>
                                <small>
                                  {contactAge(person.last_interaction_at)}
                                </small>
                                <span>
                                  <MessageSquare size={14} />
                                  ثبت تعامل
                                </span>
                              </button>
                            ))
                          ) : (
                            <Empty title="شبکه شما آماده یک آشنایی تازه است" />
                          )}
                        </div>
                      </section>
                    </div>
                    <div className="secondary-column">
                      <Graph
                        compact
                        onPerson={openPerson}
                        revision={revision}
                      />
                      <section className="occasion-panel">
                        <div className="section-head">
                          <h2>بهانه‌ای برای خوشحال‌کردن</h2>
                          <span className="soft-badge">پیش رو</span>
                        </div>
                        {dashboard.events.filter(
                          (e: any) => e.event_type === "occasion",
                        ).length ? (
                          (() => {
                            const event = dashboard.events.find(
                              (e: any) => e.event_type === "occasion",
                            );
                            return (
                              <>
                                <div className="birthday-person">
                                  <span className="birthday-icon">
                                    <Gift size={28} />
                                  </span>
                                  <div>
                                    <h3>
                                      {event.title} {event.person_name}
                                    </h3>
                                    <p>{faDate(event.occurrence_date)}</p>
                                  </div>
                                </div>
                                <div className="birthday-footer">
                                  <button
                                    onClick={() =>
                                      flower(event.person_id, event)
                                    }
                                  >
                                    <Flower2 size={17} />
                                    سفارش گل
                                  </button>
                                </div>
                              </>
                            );
                          })()
                        ) : (
                          <div className="agenda-event">
                            <p>در این بازه مناسبتی ندارید.</p>
                            <button
                              className="text-button"
                              onClick={() => setWorkflow({ type: "occasion" })}
                            >
                              ثبت یک مناسبت
                            </button>
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                  <section className="upcoming-section">
                    <div className="section-head">
                      <h2>روی تقویم شما</h2>
                      <button
                        className="text-button"
                        onClick={() => go("calendar")}
                      >
                        مشاهده تقویم <ChevronLeft size={16} />
                      </button>
                    </div>
                    <div className="occasion-cards">
                      {dashboard.events
                        .filter((e: any) => e.event_type === "occasion")
                        .slice(0, 3)
                        .map((event: any, i: number) => (
                          <button
                            className="occasion-card"
                            key={event.id + event.occurrence_date}
                            onClick={() => openPerson(event.person_id)}
                          >
                            <div className={"date-tile date-" + i}>
                              <strong>
                                {faDate(event.occurrence_date, {
                                  day: "numeric",
                                  month: undefined,
                                })}
                              </strong>
                              <span>
                                {faDate(event.occurrence_date, {
                                  month: "short",
                                  day: undefined,
                                })}
                              </span>
                            </div>
                            <div>
                              <strong>
                                {event.title} {event.person_name}
                              </strong>
                              <small>
                                {event.recurrence === "yearly"
                                  ? "مناسبت سالانه"
                                  : "مناسبت یک‌باره"}
                              </small>
                            </div>
                            <ChevronLeft size={17} />
                          </button>
                        ))}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          {view === "people" && (
            <>
              {heading(
                "افراد و ارتباط‌ها",
                `${fa(dashboard?.stats.people ?? 0)} نفر، با تجربه‌ها و فرصت‌های متفاوت.`,
                "آدم‌های دنیای شما",
                <button
                  className="primary"
                  onClick={() => setWorkflow({ type: "person" })}
                >
                  <UserPlus size={18} />
                  افزودن فرد
                </button>,
              )}
              <div className="people-tools">
                <div className="search-box">
                  <Search size={19} />
                  <input
                    placeholder="نام، موبایل، شرکت یا تخصص"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="جست‌وجو در فهرست افراد"
                  />
                </div>
                <select
                  className="pick"
                  aria-label="سطح اهمیت"
                  value={importance}
                  onChange={(e) => setImportance(e.target.value)}
                >
                  <option value="all">همه اولویت‌ها</option>
                  <option value="A">A · بسیار مهم</option>
                  <option value="B">B · مهم</option>
                  <option value="C">C · عادی</option>
                </select>
                <label className="check-label archive-filter">
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => setArchived(e.target.checked)}
                  />
                  بایگانی‌شده‌ها
                </label>
              </div>
              <div className="tag-filters">
                <button
                  className={!tag ? "active" : ""}
                  onClick={() => setTag("")}
                >
                  همه
                </button>
                {tags.map((t) => (
                  <button
                    key={t.id}
                    className={tag === t.name ? "active" : ""}
                    onClick={() => setTag(t.name)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <div className="panel people-table">
                {peopleLoading ? (
                  <Busy />
                ) : people.length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>نام و مشخصات</th>
                        <th>شرکت و سمت</th>
                        <th>تخصص</th>
                        <th>اهمیت</th>
                        <th>آخرین تعامل</th>
                        <th>
                          <span className="sr-only">پروفایل</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((person) => (
                        <tr key={person.id}>
                          <td>
                            <button
                              className="name-cell"
                              onClick={() => openPerson(person.id)}
                            >
                              <Avatar p={person} />
                              <span>
                                <strong>{person.display_name}</strong>
                                <small>
                                  {person.introduction_source === "person"
                                    ? "از طریق " + person.introduced_by_name
                                    : person.introduction_source === "direct"
                                      ? "آشنایی مستقیم"
                                      : "نحوه آشنایی نامشخص"}
                                </small>
                              </span>
                            </button>
                          </td>
                          <td>
                            <strong>{person.company || "—"}</strong>
                            <small>{person.job_title}</small>
                          </td>
                          <td>
                            <div className="table-tags">
                              {person.tags?.map((t) => (
                                <span key={t}>{t}</span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <span
                              className={
                                "level-badge level-" + person.importance_level
                              }
                            >
                              {person.importance_level}
                            </span>
                          </td>
                          <td>{contactAge(person.last_interaction_at)}</td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={"بازکردن " + person.display_name}
                              onClick={() => openPerson(person.id)}
                            >
                              <ChevronLeft size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <Empty title="فردی پیدا نشد">
                    <button
                      className="text-button"
                      onClick={() => {
                        setQuery("");
                        setTag("");
                        setImportance("all");
                      }}
                    >
                      پاک کردن فیلترها
                    </button>
                  </Empty>
                )}
                <div className="table-footer">
                  نمایش {fa(people.length)} نفر{" "}
                  {peopleCursor && (
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          const d = await api(
                            "people?" +
                              new URLSearchParams({
                                q: query,
                                importance,
                                active: String(!archived),
                                limit: "30",
                                cursor: peopleCursor,
                                ...(tag ? { tag } : {}),
                              }),
                          );
                          setPeople((v) => [...v, ...d.items]);
                          setPeopleCursor(d.next_cursor);
                        } catch (e) {
                          setError(e as Error);
                        }
                      }}
                    >
                      نمایش بیشتر
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          {view === "network" && (
            <>
              {heading(
                "شبکه روابط",
                "مسیر معرفی را از روابط عمومی افراد جدا دنبال کنید.",
                "هر آشنایی، آغاز یک مسیر",
                <button className="secondary" onClick={() => go("people")}>
                  <Users size={18} />
                  نمایش فهرست
                </button>,
              )}
              <Graph onPerson={openPerson} revision={revision} />
              <div className="network-guide">
                <span>
                  <Network size={17} />
                  فهرست روابط هر شخص در پروفایل او در دسترس است.
                </span>
              </div>
            </>
          )}
          {view === "calendar" && (
            <>
              {heading(
                "تقویم روابط",
                "روزهای مهم را در تقویم شمسی و با تکرار درست سالانه نگه دارید.",
                "روزهای مهم آدم‌های مهم",
                <button
                  className="primary"
                  onClick={() => setWorkflow({ type: "occasion" })}
                >
                  <Plus size={18} />
                  ثبت مناسبت
                </button>,
              )}
              <CalendarView
                zone={user.timezone}
                onPerson={openPerson}
                onFlower={flower}
                revision={revision}
              />
            </>
          )}
          {view === "actions" && (
            <>
              {heading(
                "اقدامات شما",
                "تماس، دیدار یا یک پیام کوتاه؛ هر کدام مهم‌اند.",
                "برای رابطه‌ها وقت بگذارید",
                <button
                  className="primary"
                  onClick={() => setWorkflow({ type: "action" })}
                >
                  <Plus size={18} />
                  اقدام جدید
                </button>,
              )}
              <Tabs dir="rtl" value={taskFilter} onValueChange={setTaskFilter}>
                <TabsList className="app-tabs">
                  {["pending", "done", "cancelled", "all"].map((t) => (
                    <TabsTrigger value={t} key={t}>
                      {labels[t] ?? "همه"}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="panel action-page-list">
                  <div className="section-head">
                    <h2>برنامه پیگیری روابط</h2>
                    <button
                      className="text-button"
                      onClick={() => setWorkflow({ type: "flower" })}
                    >
                      <Flower2 size={17} />
                      برنامه گل
                    </button>
                  </div>
                  {taskRows(tasks)}
                  {taskCursor && (
                    <button
                      className="add-inline"
                      onClick={async () => {
                        try {
                          const d = await api(
                            "actions?cursor=" +
                              taskCursor +
                              (taskFilter === "all"
                                ? ""
                                : "&status=" + taskFilter),
                          );
                          setTasks((v) => [...v, ...d.items]);
                          setTaskCursor(d.next_cursor);
                        } catch (e) {
                          setError(e as Error);
                        }
                      }}
                    >
                      نمایش بیشتر
                    </button>
                  )}
                </div>
              </Tabs>
              <div className="soft-notice">
                <Clock size={18} />
                گل و بودجه برای هر نوبت جدا ثبت می‌شوند. پذیرش SMS، اقدام را
                انجام‌شده نمی‌کند.
              </div>
            </>
          )}
          {view === "settings" && (
            <>
              {heading(
                "تنظیمات فضای شما",
                "گلفروش‌ها، یادآوری‌ها و ورود اطلاعات را مدیریت کنید.",
                "فضای کاری شما",
              )}
              <SettingsView
                user={user}
                revision={revision}
                onChanged={() => {
                  changed();
                  loadUser();
                }}
                onWorkflow={setWorkflow}
              />
            </>
          )}
          <footer className="workspace-footer">
            <span dir="ltr">RELATIONSHIP OS</span>
            <span>با توجه، رابطه‌ها ماندگار می‌شوند.</span>
          </footer>
        </div>
      </main>
      <Sheet
        open={!!selectedId}
        onOpenChange={(v) => !v && setSelectedId(null)}
      >
        <SheetContent side="left" className="profile-sheet" dir="rtl">
          {!p ? (
            <>
              <SheetTitle className="sr-only">پروفایل فرد</SheetTitle>
              <SheetDescription className="sr-only">
                اطلاعات رابطه
              </SheetDescription>
              <Busy />
            </>
          ) : (
            <>
              <div className="profile-cover">
                <span>PERSONAL NETWORK</span>
                <Network size={74} />
              </div>
              <div className="profile-body">
                <div className="profile-identity">
                  <Avatar p={p} large />
                  <span className={"level-badge level-" + p.importance_level}>
                    {p.importance_level} ·{" "}
                    {p.importance_level === "A"
                      ? "بسیار مهم"
                      : p.importance_level === "B"
                        ? "مهم"
                        : "عادی"}
                  </span>
                </div>
                <SheetTitle className="profile-name">
                  {p.display_name}
                </SheetTitle>
                <SheetDescription>
                  {p.job_title}
                  {p.company ? " در " + p.company : ""}
                </SheetDescription>
                <div className="profile-tag-list">
                  {p.tags?.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="profile-actions">
                  {!p.is_self && (
                    <>
                      <button
                        className="primary"
                        onClick={() =>
                          setWorkflow({ type: "interaction", person: p })
                        }
                      >
                        <Plus size={16} />
                        ثبت تعامل
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          setWorkflow({ type: "flower", person: p })
                        }
                      >
                        <Flower2 size={17} />
                        گل
                      </button>
                      <button
                        className="icon-button"
                        aria-label="ویرایش فرد"
                        onClick={() =>
                          setWorkflow({ type: "person", person: p })
                        }
                      >
                        <Pencil size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="بایگانی فرد"
                        onClick={() =>
                          setWorkflow({ type: "archive", person: p })
                        }
                      >
                        <Archive size={17} />
                      </button>
                    </>
                  )}
                </div>
                <Tabs
                  dir="rtl"
                  value={profileTab}
                  onValueChange={setProfileTab}
                >
                  <TabsList className="profile-tabs">
                    {[
                      ["overview", "درباره"],
                      ["relations", "روابط"],
                      ["dates", "مناسبت‌ها"],
                      ["tasks", "اقدامات"],
                      ["timeline", "تاریخچه"],
                    ].map(([id, label]) => (
                      <TabsTrigger key={id} value={id}>
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <TabsContent value="overview">
                    <div className="profile-section">
                      <h3>اطلاعات ارتباط</h3>
                      {[
                        { icon: Building2, label: "شرکت", value: p.company },
                        { icon: MapPin, label: "شهر", value: p.city },
                        {
                          icon: Phone,
                          label: "موبایل",
                          value: p.mobile,
                          ltr: true,
                        },
                        {
                          icon: Mail,
                          label: "ایمیل",
                          value: p.email,
                          ltr: true,
                        },
                        {
                          icon: Clock,
                          label: "آخرین تعامل",
                          value: contactAge(p.last_interaction_at),
                        },
                      ].map((d) => (
                        <div className="detail-line" key={d.label}>
                          <d.icon size={18} />
                          <span>{d.label}</span>
                          <strong dir={d.ltr ? "ltr" : undefined}>
                            {d.value || "ثبت نشده"}
                          </strong>
                        </div>
                      ))}
                    </div>
                    <div className="introduction-box">
                      <Link2 size={20} />
                      <div>
                        <small>مسیر آشنایی</small>
                        <strong>
                          {profile.path.items
                            .map((r: any) => r.display_name)
                            .join(" ← ")}
                          {profile.path.incomplete
                            ? " · زنجیره ناقص یا نامشخص"
                            : ""}
                        </strong>
                      </div>
                    </div>
                    <div className="profile-section">
                      <h3>یادداشت رابطه</h3>
                      <p className="pre-wrap">
                        {p.notes || "یادداشتی ثبت نشده است."}
                      </p>
                      {p.private_notes && (
                        <>
                          <h3>یادداشت خصوصی</h3>
                          <p className="pre-wrap">{p.private_notes}</p>
                        </>
                      )}
                      {p.address && (
                        <>
                          <h3>نشانی</h3>
                          <p>{p.address}</p>
                        </>
                      )}
                    </div>
                    <div className="profile-utilities">
                      <button
                        className="text-button"
                        onClick={() =>
                          setWorkflow({ type: "reminder", person: p })
                        }
                      >
                        <Bell size={16} />
                        یادآوری
                      </button>
                      <label className="text-button">
                        <Upload size={16} />
                        تغییر عکس
                        <input
                          className="sr-only"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const body = new FormData();
                            body.set("file", f);
                            try {
                              await api(
                                "people/" + p.id + "/photo",
                                "POST",
                                body,
                              );
                              changed();
                              toast.success("عکس ذخیره شد.");
                            } catch (e) {
                              toast.error((e as Error).message);
                            }
                          }}
                        />
                      </label>
                    </div>
                  </TabsContent>
                  <TabsContent value="relations">
                    <div className="profile-section">
                      <h3>مسیر آشنایی</h3>
                      <div className="intro-path">
                        {profile.path.items.map((r: any) => (
                          <button
                            key={r.id}
                            className="text-button"
                            onClick={() => openPerson(r.id)}
                          >
                            {r.display_name}
                            <ChevronLeft size={14} />
                          </button>
                        ))}
                      </div>
                      <h3>روابط ثبت‌شده</h3>
                      {profile.relationships.length ? (
                        profile.relationships.map((r: any) => {
                          const other =
                            r.person_a_id === p.id
                              ? r.person_b_id
                              : r.person_a_id;
                          return (
                            <div className="related-person" key={r.id}>
                              <button onClick={() => openPerson(other)}>
                                <strong>
                                  {r.person_a_id === p.id
                                    ? r.person_b_name
                                    : r.person_a_name}
                                </strong>
                                <small>
                                  {r.is_directed && r.person_b_id === p.id
                                    ? r.reverse_label
                                    : r.label}
                                </small>
                              </button>
                              <button
                                className="icon-button"
                                aria-label="ویرایش رابطه"
                                onClick={() =>
                                  setWorkflow({
                                    type: "relationship",
                                    person: p,
                                    record: r,
                                  })
                                }
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className="icon-button"
                                aria-label="بایگانی رابطه"
                                onClick={async () => {
                                  try {
                                    await api(
                                      "relationships/" + r.id,
                                      "DELETE",
                                    );
                                    changed();
                                  } catch (e) {
                                    toast.error((e as Error).message);
                                  }
                                }}
                              >
                                <X size={16} />
                              </button>
                            </div>
                          );
                        })
                      ) : (
                        <Empty title="رابطه‌ای ثبت نشده" />
                      )}
                      <button
                        className="add-inline"
                        onClick={() =>
                          setWorkflow({ type: "relationship", person: p })
                        }
                      >
                        <Plus size={17} />
                        افزودن رابطه
                      </button>
                    </div>
                  </TabsContent>
                  <TabsContent value="dates">
                    <div className="profile-section">
                      <h3>مناسبت‌های مهم</h3>
                      {profile.dates.map((d: any) => (
                        <div className="detail-line" key={d.id}>
                          <Gift size={20} />
                          <div>
                            <strong>{d.title}</strong>
                            <small>
                              {fa(d.day)} / {fa(d.month)}{" "}
                              {d.calendar === "jalali" ? "شمسی" : "میلادی"} ·{" "}
                              {d.recurrence === "yearly" ? "سالانه" : "یک‌باره"}
                              <br />
                              {d.leap_policy === "skip"
                                ? "روز کبیسه: رد سال غیرکبیسه"
                                : "روز کبیسه: آخرین روز ماه"}
                            </small>
                          </div>
                          <button
                            className="icon-button"
                            aria-label={"ویرایش " + d.title}
                            onClick={() =>
                              setWorkflow({
                                type: "occasion",
                                person: p,
                                record: d,
                              })
                            }
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={"حذف " + d.title}
                            onClick={async () => {
                              try {
                                await api("important-dates/" + d.id, "DELETE");
                                changed();
                              } catch (e) {
                                toast.error((e as Error).message);
                              }
                            }}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                      <button
                        className="add-inline"
                        onClick={() =>
                          setWorkflow({ type: "occasion", person: p })
                        }
                      >
                        <Plus size={17} />
                        ثبت مناسبت
                      </button>
                    </div>
                  </TabsContent>
                  <TabsContent value="tasks">
                    <div className="profile-section">
                      {taskRows(profile.actions)}
                      <button
                        className="add-inline"
                        onClick={() =>
                          setWorkflow({ type: "action", person: p })
                        }
                      >
                        <Plus size={17} />
                        اقدام جدید
                      </button>
                    </div>
                  </TabsContent>
                  <TabsContent value="timeline">
                    <div className="timeline">
                      {profile.timeline.length ? (
                        profile.timeline.map((i: any) => (
                          <div className="timeline-item" key={i.id}>
                            <span className="timeline-symbol">
                              <MessageSquare size={16} />
                            </span>
                            <small>
                              {faDate(i.occurred_at, {
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </small>
                            <h3>
                              {labels[i.interaction_type] ?? i.interaction_type}
                              {!i.counts_as_contact
                                ? " · بدون اثر در آخرین تماس"
                                : ""}
                            </h3>
                            <p className="pre-wrap">{i.notes}</p>
                          </div>
                        ))
                      ) : (
                        <Empty title="تعاملی ثبت نشده" />
                      )}
                      {profile.timeline_cursor && (
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              const data = await api(
                                "people/" +
                                  p.id +
                                  "/timeline?cursor=" +
                                  profile.timeline_cursor,
                              );
                              setProfile((prev: any) => ({
                                ...prev,
                                timeline: [...prev.timeline, ...data.items],
                                timeline_cursor: data.next_cursor,
                              }));
                            } catch (e) {
                              toast.error((e as Error).message);
                            }
                          }}
                        >
                          نمایش بیشتر
                        </button>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <Sheet open={notifyOpen} onOpenChange={setNotifyOpen}>
        <SheetContent side="left" className="notification-sheet" dir="rtl">
          <SheetTitle>یادآوری‌های شما</SheetTitle>
          <SheetDescription>چیزهایی که بهتر است فراموش نشوند.</SheetDescription>
          {notifications.length ? (
            notifications.map((n) => (
              <button
                className={"notification " + (!n.read_at ? "unread" : "")}
                key={n.id}
                onClick={async () => {
                  try {
                    await api("notifications/" + n.id + "/read", "POST", {});
                    changed();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <span className="task-icon call">
                  <Bell size={22} />
                </span>
                <div>
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                  <small>
                    {faDate(n.created_at, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {n.read_at ? " · خوانده‌شده" : " · خوانده‌نشده"}
                  </small>
                </div>
              </button>
            ))
          ) : (
            <Empty title="اعلان تازه‌ای ندارید" />
          )}
        </SheetContent>
      </Sheet>
      {workflow && (
        <WorkflowModal
          key={
            String(workflow.record?.version ?? workflow.person?.version ?? 0) +
            workflow.type +
            (workflow.record?.id ?? workflow.person?.id ?? "new")
          }
          workflow={workflow}
          user={user}
          onClose={() => setWorkflow(null)}
          onSaved={saved}
        />
      )}
      <Toaster position="bottom-left" dir="rtl" richColors />
    </SidebarProvider>
  );
}
