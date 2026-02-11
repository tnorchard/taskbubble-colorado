import { useEffect, useState } from "react";
import { getSupabase } from "../lib/supabaseClient";
import type { Profile, Task } from "../types";

type TaskWithWorkspace = Task & { workspace_name?: string };

type AdminUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  shopify_store_ids: string[]; // IDs of stores this user can access
};

type ShopifyStoreInfo = {
  id: string;
  shop_handle: string;
  display_name: string;
};

type AdminWorkspaceRow = {
  id: string;
  name: string;
  join_code: string;
  created_by: string | null;
  created_at: string;
  member_count: number;
};

type WsMemberRow = {
  user_id: string;
  role: string;
  email: string | null;
  display_name: string | null;
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function userInitials(name: string | null | undefined, email: string | null | undefined) {
  const src = name || email || "U";
  const clean = src.includes("@") ? src.split("@")[0] : src;
  const parts = clean.replace(/[^a-zA-Z0-9 ]/g, " ").split(" ").filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (a + b).toUpperCase();
}

export function ProfilePage() {
  const supabase = getSupabase();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tasks, setTasks] = useState<TaskWithWorkspace[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [userColor, setUserColor] = useState("#64b5ff");
  const [colorInput, setColorInput] = useState("#64b5ff");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [adminWorkspaces, setAdminWorkspaces] = useState<AdminWorkspaceRow[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminRpcReady, setAdminRpcReady] = useState(true);
  const [adminTab, setAdminTab] = useState<"users" | "workspaces">("users");
  const [allShopifyStores, setAllShopifyStores] = useState<ShopifyStoreInfo[]>([]);

  // Workspace member management
  const [expandedWsId, setExpandedWsId] = useState<string | null>(null);
  const [wsMembers, setWsMembers] = useState<WsMemberRow[]>([]);
  const [wsMembersLoading, setWsMembersLoading] = useState(false);
  const [addUserId, setAddUserId] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setError(null);
    const [{ data: userData, error: userErr }, { data: wsData }, { data: taskData }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("workspaces").select("id,name,created_at"),
      supabase.from("tasks").select("id,title,description,due_date,status,created_at,created_by,workspace_id"),
    ]);
    if (userErr) setError(userErr.message);
    const uid = userData.user?.id;
    if (!uid) { setError("No user session"); return; }
    const email = userData.user?.email ?? null;
    const admin = (email ?? "").toLowerCase() === "dexter.norales@gmail.com";
    setIsAdmin(admin);
    const { data: profData, error: profErr } = await supabase
      .from("profiles").select("id,email,display_name,avatar_url,user_color").eq("id", uid).maybeSingle();
    if (profErr) setError(profErr.message);
    setProfile((profData as Profile) ?? null);
    setDisplayName(profData?.display_name ?? "");
    const uc = profData?.user_color ?? "#64b5ff";
    setUserColor(uc);
    setColorInput(uc);
    const ws = (wsData ?? []) as Array<{ id: string; name: string }>;
    const wsMap = new Map(ws.map((w) => [w.id, w]));
    const mine = (taskData ?? []).filter((t) => t.created_by === uid) as TaskWithWorkspace[];
    mine.forEach((t) => { t.workspace_name = wsMap.get(t.workspace_id)?.name; });
    setTasks(mine);
    if (admin) { await loadAdminData(); }
    else { setAdminUsers([]); setAdminWorkspaces([]); setAdminError(null); }
  }

  async function loadAdminData() {
    setAdminLoading(true);
    setAdminError(null);

    // Fetch Shopify stores for the admin toggle UI
    const { data: storeRows } = await supabase
      .from("shopify_stores_public").select("id,shop_handle,display_name").order("created_at", { ascending: true });
    setAllShopifyStores((storeRows ?? []) as ShopifyStoreInfo[]);

    // Fetch all user<->store access rows (admin can read all via RLS policy)
    const { data: accessRows } = await supabase.from("user_shopify_access").select("user_id,store_id");
    const accessMap = new Map<string, string[]>();
    ((accessRows ?? []) as Array<{ user_id: string; store_id: string }>).forEach((r) => {
      const list = accessMap.get(r.user_id) ?? [];
      list.push(r.store_id);
      accessMap.set(r.user_id, list);
    });

    const [{ data: users, error: usersErr }, { data: workspaces, error: wsErr }] = await Promise.all([
      supabase.rpc("admin_list_users"),
      supabase.rpc("admin_list_workspaces"),
    ]);
    const missingRpc = usersErr?.message?.includes("Could not find the function") || wsErr?.message?.includes("Could not find the function");

    function enrichUser(p: { id: string; email: string | null; display_name: string | null; created_at: string; last_sign_in_at?: string | null }): AdminUserRow {
      return { ...p, last_sign_in_at: p.last_sign_in_at ?? null, shopify_store_ids: accessMap.get(p.id) ?? [] };
    }

    if (missingRpc) {
      setAdminRpcReady(false);
      const [{ data: profileRows }, { data: wsRows }, { data: memberRows }] = await Promise.all([
        supabase.from("profiles").select("id,email,display_name,created_at"),
        supabase.from("workspaces").select("id,name,join_code,created_by,created_at"),
        supabase.from("workspace_members").select("workspace_id"),
      ]);
      const counts = new Map<string, number>();
      ((memberRows ?? []) as Array<{ workspace_id: string }>).forEach((m) => {
        counts.set(m.workspace_id, (counts.get(m.workspace_id) ?? 0) + 1);
      });
      setAdminUsers(((profileRows ?? []) as Array<{ id: string; email: string | null; display_name: string | null; created_at: string }>).map(enrichUser));
      setAdminWorkspaces(((wsRows ?? []) as Array<{ id: string; name: string; join_code: string; created_by: string | null; created_at: string }>).map(
        (w) => ({ ...w, member_count: counts.get(w.id) ?? 0 }),
      ));
      setAdminError("Admin RPCs not deployed. Read-only mode.");
      setAdminLoading(false);
      return;
    }
    setAdminRpcReady(true);
    if (usersErr) {
      const { data: profileRows } = await supabase.from("profiles").select("id,email,display_name,created_at");
      setAdminUsers(((profileRows ?? []) as Array<{ id: string; email: string | null; display_name: string | null; created_at: string }>).map(enrichUser));
      setAdminError("admin_list_users RPC failing. Showing profiles fallback.");
    } else {
      const rpcUsers = (users ?? []) as Array<{ id: string; email: string | null; display_name: string | null; created_at: string; last_sign_in_at: string | null }>;
      setAdminUsers(rpcUsers.map(enrichUser));
    }
    if (wsErr) setAdminError(wsErr.message);
    setAdminWorkspaces((workspaces ?? []) as AdminWorkspaceRow[]);
    setAdminLoading(false);
  }

  async function loadWsMembers(wsId: string) {
    setWsMembersLoading(true);
    const { data: memData } = await supabase
      .from("workspace_members").select("user_id,role").eq("workspace_id", wsId);
    const userIds = (memData ?? []).map((m: any) => m.user_id as string);
    let profiles: Array<{ id: string; email: string | null; display_name: string | null }> = [];
    if (userIds.length) {
      const { data: profData } = await supabase.from("profiles").select("id,email,display_name").in("id", userIds);
      profiles = (profData ?? []) as typeof profiles;
    }
    const profMap = new Map(profiles.map((p) => [p.id, p]));
    setWsMembers((memData ?? []).map((m: any) => ({
      user_id: m.user_id,
      role: m.role,
      email: profMap.get(m.user_id)?.email ?? null,
      display_name: profMap.get(m.user_id)?.display_name ?? null,
    })));
    setWsMembersLoading(false);
  }

  async function toggleWsExpand(wsId: string) {
    if (expandedWsId === wsId) { setExpandedWsId(null); return; }
    setExpandedWsId(wsId);
    await loadWsMembers(wsId);
  }

  async function removeFromWorkspace(wsId: string, userId: string, label: string) {
    if (!window.confirm(`Remove ${label} from this workspace?`)) return;
    const { error: e } = await supabase.from("workspace_members").delete().eq("workspace_id", wsId).eq("user_id", userId);
    if (e) { setAdminError(e.message); return; }
    setNotice(`Removed ${label}`);
    await loadWsMembers(wsId);
    await loadAdminData();
  }

  async function addToWorkspace(wsId: string) {
    if (!addUserId) return;
    const { error: e } = await supabase.rpc("add_workspace_member", {
      p_workspace_id: wsId,
      p_user_id: addUserId,
      p_role: "member",
    });
    if (e) {
      if (e.message.includes("duplicate") || e.message.includes("already")) setAdminError("User is already a member.");
      else setAdminError(e.message);
      return;
    }
    setAddUserId("");
    setNotice("User added to workspace");
    await loadWsMembers(wsId);
    await loadAdminData();
  }

  async function adminDeleteUser(u: AdminUserRow) {
    setAdminError(null);
    const label = u.email ?? u.id;
    if (!window.confirm(`Are you sure you want to delete user "${label}"?\n\nThis permanently removes their account, profile, memberships, and tasks. Cannot be undone.`)) return;
    const { error: e } = await supabase.rpc("admin_delete_user", { p_user_id: u.id });
    if (e) { setAdminError(e.message); return; }
    setNotice(`Deleted user ${label}`);
    await loadAdminData();
  }

  async function adminDeleteWorkspace(w: AdminWorkspaceRow) {
    setAdminError(null);
    if (!window.confirm(`Are you sure you want to delete workspace "${w.name}"?\n\nThis removes it for everyone and cascade-deletes all memberships and tasks. Cannot be undone.`)) return;
    const { error: e } = await supabase.rpc("admin_delete_workspace", { p_workspace_id: w.id });
    if (e) { setAdminError(e.message); return; }
    if (expandedWsId === w.id) setExpandedWsId(null);
    setNotice(`Deleted workspace "${w.name}"`);
    await loadAdminData();
  }

  async function toggleStoreAccess(userId: string, storeId: string, currentlyHas: boolean) {
    setAdminError(null);
    if (currentlyHas) {
      const { error: e } = await supabase.from("user_shopify_access").delete().eq("user_id", userId).eq("store_id", storeId);
      if (e) { setAdminError(e.message); return; }
      setAdminUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, shopify_store_ids: u.shopify_store_ids.filter((s) => s !== storeId) } : u
      ));
    } else {
      const { error: e } = await supabase.from("user_shopify_access").insert({ user_id: userId, store_id: storeId });
      if (e) { setAdminError(e.message); return; }
      setAdminUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, shopify_store_ids: [...u.shopify_store_ids, storeId] } : u
      ));
    }
    const store = allShopifyStores.find((s) => s.id === storeId);
    const userName = adminUsers.find((u) => u.id === userId)?.email ?? userId;
    setNotice(`${currentlyHas ? "Revoked" : "Granted"} ${store?.display_name ?? "store"} access for ${userName}`);
  }

  async function adminSendPasswordReset(u: AdminUserRow) {
    if (!u.email) { setAdminError("This user has no email on file."); return; }
    if (!window.confirm(`Send a password reset email to ${u.email}?`)) return;
    setAdminError(null);
    const { error: e } = await supabase.auth.resetPasswordForEmail(u.email, {
      redirectTo: window.location.origin + "/auth",
    });
    if (e) { setAdminError(e.message); return; }
    setNotice(`Password reset email sent to ${u.email}`);
  }

  async function saveProfile() {
    setSaving(true); setError(null); setNotice(null);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) { setError("No user session"); setSaving(false); return; }
    const { error: e } = await supabase.from("profiles").update({
      display_name: displayName.trim() || null,
      user_color: userColor || "#64b5ff",
    }).eq("id", uid);
    if (e) setError(e.message); else setNotice("Profile updated");
    setSaving(false);
    await load();
  }

  async function sendPasswordReset() {
    setNotice(null); setError(null);
    if (!profile?.email) { setError("No email on file."); return; }
    const { error: e } = await supabase.auth.resetPasswordForEmail(profile.email, { redirectTo: window.location.origin + "/auth" });
    if (e) setError(e.message); else setNotice("Password reset email sent.");
  }

  const isCurrentUser = (uid: string) => uid === profile?.id;
  const nonMemberUsers = adminUsers.filter((u) => !wsMembers.some((m) => m.user_id === u.id));

  return (
    <div className="screen">
      <div className="screenInner" style={{ maxWidth: 960 }}>
        {error ? <div className="profileToast profileToastError">{error}</div> : null}
        {notice ? <div className="profileToast profileToastSuccess">{notice}</div> : null}

        {/* ── Profile ── */}
        <div className="profileSection">
          <div className="profileHero">
            <div className="profileAvatarLg" style={{ borderColor: userColor, boxShadow: `0 0 0 3px ${userColor}33` }}>
              {userInitials(profile?.display_name, profile?.email)}
            </div>
            <div className="profileHeroInfo">
              <div className="profileName">
                <span className="profileColorDot" style={{ background: userColor }} />
                {profile?.display_name || "Unnamed"}
              </div>
              <div className="profileEmail">{profile?.email ?? "—"}</div>
            </div>
          </div>
          <div className="profileColumns">
            <div className="profileFormCard">
              <div className="profileFormTitle">Edit Profile</div>
              <label className="profileField">
                <span className="profileFieldLabel">Display name</span>
                <input className="profileInput" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
              </label>
              <label className="profileField">
                <span className="profileFieldLabel">Email</span>
                <input className="profileInput" value={profile?.email ?? ""} readOnly style={{ opacity: 0.6 }} />
              </label>

              {/* Color picker */}
              <div className="profileColorSection">
                <div className="profileColorSectionHeader">
                  <span className="profileFieldLabel">&#127912; Choose Your Color</span>
                </div>
                <div className="profileColorCurrentRow">
                  <div className="profileColorCurrentSwatch" style={{ background: userColor }} />
                  <div className="profileColorCurrentInfo">
                    <div className="profileColorCurrentLabel">Current color</div>
                    <div className="profileColorCurrentHex">{userColor}</div>
                  </div>
                </div>
                <div className="profileColorDesc muted">
                  This color represents you across all workspaces — in bubbles, member dots, and activity feeds.
                </div>
                <div className="profileColorGridLabel">Pick a preset</div>
                <div className="profileColorGrid">
                  {["#64b5ff","#a885ff","#ff85a1","#ffb385","#85ff9e","#85fff3","#ffeb85","#ff85f3",
                    "#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899",
                    "#f43f5e","#d946ef","#14b8a6","#84cc16","#6366f1","#0ea5e9","#f59e0b","#10b981"
                  ].map((c) => (
                    <button key={c} type="button"
                      className={`profileColorSwatch ${userColor === c ? "active" : ""}`}
                      style={{ background: c }}
                      onClick={() => { setUserColor(c); setColorInput(c); }}
                      title={c} />
                  ))}
                </div>
                <div className="profileColorGridLabel">Or pick a custom color</div>
                <div className="profileColorCustom">
                  <input type="color" value={userColor} onChange={(e) => { setUserColor(e.target.value); setColorInput(e.target.value); }}
                    className="profileColorNative" title="Open color picker" />
                  <input type="text" className="profileInput profileColorHex" value={colorInput}
                    onChange={(e) => {
                      setColorInput(e.target.value);
                      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setUserColor(e.target.value);
                    }}
                    placeholder="#64b5ff" maxLength={7} />
                </div>
              </div>

              <div className="profileFormActions">
                <button className="primaryBtn" onClick={saveProfile} disabled={saving} style={{ flex: 1 }}>{saving ? "Saving…" : "Save changes"}</button>
                <button className="profileBtnGhost" onClick={sendPasswordReset} type="button">Reset password</button>
              </div>
            </div>
            <div className="profileFormCard">
              <div className="profileFormTitle">Your Tasks</div>
              <div className="profileTaskScroll">
                {tasks.length === 0 ? <div className="muted" style={{ textAlign: "center", padding: 20 }}>No tasks yet.</div> : tasks.map((t) => (
                  <div key={t.id} className="profileTaskItem">
                    <div className="profileTaskTitle">{t.title}</div>
                    <span className="profileTaskChip">{t.workspace_name ?? "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Admin ── */}
        {isAdmin ? (
          <div className="adminSection">
            <div className="adminHeader">
              <div>
                <div className="adminTitle">Admin Console</div>
                <div className="adminSubtitle">Manage users and workspaces. Actions are permanent.</div>
              </div>
              <button className="adminRefreshBtn" type="button" onClick={() => void loadAdminData()} disabled={adminLoading}>
                {adminLoading ? <span className="adminSpinner" /> : <span>&#8635;</span>}
                {adminLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {adminError ? <div className="adminAlert">{adminError}</div> : null}
            {!adminRpcReady ? (
              <div className="adminAlertWarn">Read-only mode — deploy migration <code>0008_admin_tools.sql</code> to enable deletes.</div>
            ) : null}

            <div className="adminTabs">
              <button className={`adminTab ${adminTab === "users" ? "active" : ""}`} onClick={() => setAdminTab("users")}>
                Users<span className="adminTabCount">{adminUsers.length}</span>
              </button>
              <button className={`adminTab ${adminTab === "workspaces" ? "active" : ""}`} onClick={() => setAdminTab("workspaces")}>
                Workspaces<span className="adminTabCount">{adminWorkspaces.length}</span>
              </button>
            </div>

            {/* Users tab */}
            {adminTab === "users" ? (
              <div className="adminList">
                {adminUsers.length === 0 ? (
                  <div className="muted" style={{ textAlign: "center", padding: 32 }}>{adminLoading ? "Loading…" : "No users found."}</div>
                ) : adminUsers.map((u) => (
                  <div key={u.id} className={`adminCard ${isCurrentUser(u.id) ? "adminCardSelf" : ""}`}>
                    <div className="adminCardAvatar">{userInitials(u.display_name, u.email)}</div>
                    <div className="adminCardBody">
                      <div className="adminCardPrimary">
                        {u.email ?? u.id}
                        {isCurrentUser(u.id) ? <span className="adminBadge adminBadgeYou">You</span> : null}
                      </div>
                      <div className="adminCardSecondary">
                        <span>{u.display_name ?? "No display name"}</span>
                        <span className="adminDot" />
                        <span>Joined {fmtDate(u.created_at)}</span>
                        {u.last_sign_in_at ? <><span className="adminDot" /><span>Last seen {fmtDate(u.last_sign_in_at)}</span></> : null}
                      </div>
                    </div>
                    <div className="adminCardActions">
                      {allShopifyStores.length > 0 ? (
                        <div className="adminShopifyToggles">
                          {allShopifyStores.map((store) => {
                            const has = u.shopify_store_ids.includes(store.id);
                            return (
                              <button key={store.id}
                                className={`adminShopifyBtn ${has ? "active" : ""}`}
                                type="button"
                                onClick={() => void toggleStoreAccess(u.id, store.id, has)}
                                disabled={adminLoading}
                                title={has ? `Revoke ${store.display_name} access` : `Grant ${store.display_name} access`}>
                                🛍 {store.display_name}: {has ? "On" : "Off"}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <button className="adminResetBtn" type="button" onClick={() => void adminSendPasswordReset(u)}
                        disabled={adminLoading || !u.email}
                        title={u.email ? `Send password reset to ${u.email}` : "No email on file"}>
                        <span style={{ fontSize: 13 }}>&#9993;</span>Reset&nbsp;pw
                      </button>
                      <button className="adminDeleteBtn" type="button" onClick={() => void adminDeleteUser(u)}
                        disabled={adminLoading || !adminRpcReady || isCurrentUser(u.id)}
                        title={isCurrentUser(u.id) ? "Cannot delete yourself" : `Delete ${u.email}`}>
                        <span style={{ fontSize: 14 }}>&#128465;</span>Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Workspaces tab */}
            {adminTab === "workspaces" ? (
              <div className="adminList">
                {adminWorkspaces.length === 0 ? (
                  <div className="muted" style={{ textAlign: "center", padding: 32 }}>{adminLoading ? "Loading…" : "No workspaces found."}</div>
                ) : adminWorkspaces.map((w) => (
                  <div key={w.id}>
                    <div className={`adminCard ${w.name === "Home" ? "adminCardHome" : ""}`} style={{ cursor: "pointer" }} onClick={() => void toggleWsExpand(w.id)}>
                      <div className="adminCardIcon">{w.name === "Home" ? "\u2302" : "\u25A0"}</div>
                      <div className="adminCardBody">
                        <div className="adminCardPrimary">
                          {w.name}
                          {w.name === "Home" ? <span className="adminBadge adminBadgeSystem">System</span> : null}
                          <span className="adminBadge" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--muted)" }}>
                            {expandedWsId === w.id ? "▾" : "▸"} Members
                          </span>
                        </div>
                        <div className="adminCardSecondary">
                          <span>{w.member_count} member{w.member_count !== 1 ? "s" : ""}</span>
                          <span className="adminDot" />
                          <span>Created {fmtDate(w.created_at)}</span>
                          <span className="adminDot" />
                          <span className="adminCodeChip">{w.join_code}</span>
                        </div>
                      </div>
                      <button className="adminDeleteBtn" type="button"
                        onClick={(e) => { e.stopPropagation(); void adminDeleteWorkspace(w); }}
                        disabled={adminLoading || w.name === "Home" || !adminRpcReady}
                        title={w.name === "Home" ? "Cannot delete Home" : `Delete ${w.name}`}>
                        <span style={{ fontSize: 14 }}>&#128465;</span>Delete
                      </button>
                    </div>

                    {/* Expanded member list */}
                    {expandedWsId === w.id ? (
                      <div className="adminWsMembers">
                        {wsMembersLoading ? (
                          <div className="muted" style={{ padding: 12 }}>Loading members…</div>
                        ) : (
                          <>
                            {wsMembers.map((m) => (
                              <div key={m.user_id} className="adminWsMemberRow">
                                <div className="adminCardAvatar" style={{ width: 30, height: 30, fontSize: 11 }}>
                                  {userInitials(m.display_name, m.email)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 750, color: "#fff" }}>{m.email ?? m.user_id}</div>
                                  <div className="adminCardSecondary">
                                    <span>{m.display_name ?? "—"}</span>
                                    <span className="adminDot" />
                                    <span className="adminBadge" style={{ background: m.role === "owner" ? "rgba(100,181,255,0.12)" : "rgba(255,255,255,0.06)", borderColor: m.role === "owner" ? "rgba(100,181,255,0.25)" : "rgba(255,255,255,0.1)", color: m.role === "owner" ? "var(--primary)" : "var(--muted)" }}>
                                      {m.role}
                                    </span>
                                  </div>
                                </div>
                                <button className="adminDeleteBtn" type="button" style={{ padding: "4px 10px", fontSize: 11 }}
                                  onClick={() => void removeFromWorkspace(w.id, m.user_id, m.email ?? m.user_id)}>
                                  Remove
                                </button>
                              </div>
                            ))}
                            {wsMembers.length === 0 ? <div className="muted" style={{ padding: 12 }}>No members.</div> : null}
                            <div className="adminWsAddRow">
                              <select className="adminWsAddSelect" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
                                <option value="">Add a user…</option>
                                {nonMemberUsers.map((u) => (
                                  <option key={u.id} value={u.id}>{u.email ?? u.display_name ?? u.id}</option>
                                ))}
                              </select>
                              <button className="primaryBtn" style={{ padding: "8px 14px", fontSize: 12 }} disabled={!addUserId} onClick={() => void addToWorkspace(w.id)}>
                                Add
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
