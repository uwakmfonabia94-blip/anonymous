import { SUPABASE_URL, SUPABASE_ANON_KEY, detectUniversity } from './config.js';

const SESSION_KEY = 'anon.session';
export const universitySlug = detectUniversity();

// ---------- SESSION ----------

export function getSession() {
  try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function setSession(s) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}
export function isAuthed() { return !!(getSession()?.access_token); }

function headers(token, extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function refresh() {
  const s = getSession();
  if (!s?.refresh_token) throw new Error('auth_required');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) { setSession(null); throw new Error('auth_required'); }
  const d = await res.json();
  setSession({
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: Date.now() + d.expires_in * 1000, user_id: d.user.id,
  });
  return getSession();
}

async function handleResponse(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(text || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

export async function publicFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: headers(null, opts.headers) });
  return handleResponse(res);
}

export async function authFetch(path, opts = {}, retry = true) {
  let s = getSession();
  if (!s?.access_token) throw new Error('auth_required');
  if (s.expires_at && s.expires_at < Date.now() + 60_000) {
    try { s = await refresh(); } catch { throw new Error('auth_required'); }
  }
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: headers(s.access_token, opts.headers) });
  if (res.status === 401 && retry) {
    try { await refresh(); } catch { throw new Error('auth_required'); }
    return authFetch(path, opts, false);
  }
  return handleResponse(res);
}

const rpc     = (name, args) => publicFetch(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
const authRpc = (name, args) => authFetch(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

// ---------- AUTH ----------

export async function signUp({ email, password, inviteCode, agreed, alias }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      email, password,
      data: { invite_code: inviteCode, agreed, alias: alias.trim() },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.msg || data.error_description || data.message || 'signup_failed');
  }
  setSession({
    access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000, user_id: data.user.id,
  });
  return data.user;
}

export async function signIn({ email, password }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'signin_failed');
  setSession({
    access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000, user_id: data.user.id,
  });
  return data.user;
}

export async function signOut() {
  const s = getSession();
  if (s?.access_token) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: headers(s.access_token) }).catch(() => {});
  }
  setSession(null);
}

// ---------- UNIVERSITY ----------

let _uniId = null;
export async function universityId() {
  if (_uniId) return _uniId;
  const rows = await publicFetch(`/rest/v1/universities?slug=eq.${universitySlug}&select=id`);
  _uniId = rows?.[0]?.id;
  if (!_uniId) throw new Error('university_not_found');
  return _uniId;
}

export const checkInviteCode     = (code)  => rpc('check_invite_code',     { p_code: code });
export const checkAliasAvailable = (alias) => rpc('check_alias_available', { p_alias: alias });

// ---------- VIEWER KEY ----------

export function getViewerKey() {
  if (isAuthed()) return getSession().user_id;
  let k = localStorage.getItem('anon.viewer_key');
  if (!k) {
    k = (crypto.randomUUID && crypto.randomUUID()) ||
        (Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem('anon.viewer_key', k);
  }
  return k;
}

// ---------- FEED ----------

export const listFeed = async ({ limit = 20, before = null, category = null } = {}) =>
  rpc('feed_posts', {
    p_university_id: await universityId(),
    p_limit: limit,
    p_before: before,
    p_category: category,
  });

export async function getHotPost() {
  try {
    const rows = await rpc('get_hot_post', { p_university_id: await universityId() });
    return rows?.[0] || null;
  } catch { return null; }
}

export async function countNewPostsSince(since) {
  try {
    return await rpc('count_new_posts_since', {
      p_university_id: await universityId(),
      p_since: since,
    });
  } catch { return 0; }
}

export async function myRecapSince(since) {
  try {
    const rows = await authRpc('my_recap_since', { p_since: since });
    return rows?.[0] || { new_replies: 0, new_upvotes: 0, new_posts: 0 };
  } catch { return { new_replies: 0, new_upvotes: 0, new_posts: 0 }; }
}

// ---------- VIEWS ----------

export async function recordView(postId) {
  try {
    return await publicFetch('/rest/v1/rpc/record_view', {
      method: 'POST',
      body: JSON.stringify({ p_post_id: postId, p_viewer_key: getViewerKey() }),
    });
  } catch { return 0; }
}

// ---------- POST COUNTS (polling for realtime updates) ----------

export async function getPostCounts(postIds) {
  if (!postIds?.length) return {};
  const list = postIds.map(id => `"${id}"`).join(',');
  try {
    const [postsRes, upvotesRes, commentsRes] = await Promise.all([
      publicFetch(`/rest/v1/posts?id=in.(${list})&select=id,view_count`),
      publicFetch(`/rest/v1/upvotes?post_id=in.(${list})&select=post_id`),
      publicFetch(`/rest/v1/comments?post_id=in.(${list})&select=post_id`),
    ]);
    const map = {};
    (postsRes || []).forEach(p => { map[p.id] = { view: p.view_count || 0, upvote: 0, comment: 0 }; });
    (upvotesRes || []).forEach(u => { if (map[u.post_id]) map[u.post_id].upvote++; });
    (commentsRes || []).forEach(c => { if (map[c.post_id]) map[c.post_id].comment++; });
    return map;
  } catch { return {}; }
}

// ---------- SINGLE POST ----------

export async function getPostFull(id) {
  try {
    const rows = await rpc('get_post_full', { p_id: id });
    if (rows?.[0]) return rows[0];
  } catch (err) {
    console.warn('[getPostFull] RPC failed, falling back to REST:', err.message || err);
  }

  try {
    const rows = await publicFetch(
      `/rest/v1/posts?id=eq.${id}&select=id,content,category,shareable,created_at,view_count,type,author_id,author:profiles!author_id(alias)`
    );
    const p = rows?.[0];
    if (!p) return null;

    let upvote_count = 0, comment_count = 0, poll_data = null;
    try {
      const v = await publicFetch(`/rest/v1/upvotes?post_id=eq.${id}&select=user_id`);
      upvote_count = v?.length || 0;
    } catch {}
    try {
      const c = await publicFetch(`/rest/v1/comments?post_id=eq.${id}&select=id`);
      comment_count = c?.length || 0;
    } catch {}
    if (p.type === 'poll') {
      try {
        poll_data = await publicFetch('/rest/v1/rpc/get_poll_results', {
          method: 'POST',
          body: JSON.stringify({ p_post_id: id }),
        });
      } catch {}
    }

    return {
      id: p.id, content: p.content, category: p.category, shareable: p.shareable,
      created_at: p.created_at, author_id: p.author_id,
      author_alias: p.author?.alias || 'Unknown',
      upvote_count, comment_count, view_count: p.view_count || 0,
      type: p.type || 'text', poll_data,
    };
  } catch (err) {
    console.error('[getPostFull] REST fallback also failed:', err);
    return null;
  }
}

// ---------- COMMENTS ----------

export async function listComments(postId) {
  try {
    return await rpc('post_comments', { p_post_id: postId });
  } catch (err) {
    console.warn('[listComments] RPC failed, falling back to REST:', err.message || err);
    try {
      const rows = await publicFetch(
        `/rest/v1/comments?post_id=eq.${postId}&select=id,post_id,parent_id,content,created_at,author_id,author:profiles!author_id(alias)&order=created_at.asc`
      );
      return (rows || []).map(c => ({
        id: c.id, post_id: c.post_id, parent_id: c.parent_id,
        content: c.content, created_at: c.created_at,
        author_id: c.author_id, author_alias: c.author?.alias || 'Unknown',
      }));
    } catch { return []; }
  }
}

export async function createComment({ postId, parentId = null, content }) {
  const rows = await authFetch(`/rest/v1/comments`, {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      post_id: postId, parent_id: parentId,
      author_id: getSession().user_id, content,
    }]),
  });
  return rows?.[0];
}

// ---------- POSTS ----------

export async function createPost({ content, category = 'General', shareable = true }) {
  const rows = await authFetch(`/rest/v1/posts`, {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      author_id: getSession().user_id,
      content, category, shareable,
    }]),
  });
  return rows?.[0];
}

export async function deletePost(postId) {
  await authFetch(`/rest/v1/posts?id=eq.${postId}`, { method: 'DELETE' });
}

// ---------- POLLS ----------

export async function createPoll({ question, options, category = 'General' }) {
  return await authRpc('create_poll', {
    p_question: question,
    p_options: options,
    p_category: category,
  });
}

export async function votePoll(postId, optionId) {
  return await authRpc('vote_poll', { p_post_id: postId, p_option_id: optionId });
}

export async function getPollResults(postId) {
  try {
    return await publicFetch('/rest/v1/rpc/get_poll_results', {
      method: 'POST',
      body: JSON.stringify({ p_post_id: postId }),
    });
  } catch { return null; }
}

// ---------- VOTES (likes) ----------

export async function toggleVote(postId, currentlyVoted) {
  const uid = getSession().user_id;
  if (currentlyVoted) {
    try {
      await authFetch(`/rest/v1/upvotes?post_id=eq.${postId}&user_id=eq.${uid}`, { method: 'DELETE' });
    } catch (e) {
      if (e.status === 404) return;
      throw e;
    }
  } else {
    try {
      await authFetch(`/rest/v1/upvotes`, {
        method: 'POST',
        body: JSON.stringify([{ post_id: postId, user_id: uid }]),
      });
    } catch (e) {
      const msg = String(e.message || e);
      if (e.status === 409 || msg.includes('23505') || msg.includes('duplicate')) return;
      throw e;
    }
  }
}

export async function getMyVotes(postIds) {
  if (!isAuthed() || !postIds.length) return [];
  const uid = getSession().user_id;
  const list = postIds.map(id => `"${id}"`).join(',');
  try {
    return await authFetch(`/rest/v1/upvotes?user_id=eq.${uid}&post_id=in.(${list})&select=post_id`) || [];
  } catch { return []; }
}

// ---------- ACTIVITY ----------

export const listActivity = () =>
  authFetch(`/rest/v1/activity?select=*&order=created_at.desc&limit=50`);

export const activityFeed = () => authRpc('activity_feed', {});

export async function markActivitySeen() {
  const uid = getSession().user_id;
  await authFetch(`/rest/v1/activity?user_id=eq.${uid}&seen=eq.false`, {
    method: 'PATCH', body: JSON.stringify({ seen: true }),
  });
}

export async function getUnreadCount() {
  if (!isAuthed()) return 0;
  const uid = getSession().user_id;
  const rows = await authFetch(`/rest/v1/activity?user_id=eq.${uid}&seen=eq.false&select=id`);
  return rows?.length || 0;
}

// ---------- PROFILE ----------

export async function getProfile() {
  const uid = getSession().user_id;
  const rows = await authFetch(`/rest/v1/profiles?id=eq.${uid}&select=*`);
  return rows?.[0];
}

export async function updateAlias(newAlias) {
  const uid = getSession().user_id;
  await authFetch(`/rest/v1/profiles?id=eq.${uid}`, {
    method: 'PATCH',
    body: JSON.stringify({ alias: newAlias.trim() }),
  });
  return newAlias.trim();
}

export async function deleteAccount() {
  await authRpc('delete_my_account', {});
  setSession(null);
}

// ---------- REPORTS ----------

export async function createReport({ postId, commentId, reason }) {
  await authFetch(`/rest/v1/reports`, {
    method: 'POST',
    body: JSON.stringify([{
      reporter_id: getSession().user_id,
      post_id: postId || null,
      comment_id: commentId || null,
      reason,
    }]),
  });
}

// ---------- COUNTS ----------

export async function countMyPosts() {
  const uid = getSession().user_id;
  const rows = await authFetch(`/rest/v1/posts?author_id=eq.${uid}&select=id`);
  return rows?.length || 0;
}

export async function countMyComments() {
  const uid = getSession().user_id;
  const rows = await authFetch(`/rest/v1/comments?author_id=eq.${uid}&select=id`);
  return rows?.length || 0;
}

// ---------- ME DASHBOARD ----------

export async function myStatsThisWeek() {
  try { const rows = await authRpc('my_stats_this_week', {}); return rows?.[0] || null; }
  catch { return null; }
}
export async function myBestPost() {
  try { const rows = await authRpc('my_best_post', {}); return rows?.[0] || null; }
  catch { return null; }
}
export async function campusGoalProgress() {
  try { const rows = await authRpc('campus_goal_progress', {}); return rows?.[0] || null; }
  catch { return null; }
}
export async function myMilestones() {
  try { const result = await authRpc('my_milestones', {}); return Array.isArray(result) ? result : []; }
  catch { return []; }
}

// ---------- PUSH ----------

export async function savePushSubscription(sub) {
  const uid = getSession().user_id;
  await authFetch(`/rest/v1/push_subscriptions`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{
      user_id: uid,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    }]),
  });
}

export async function deletePushSubscription(endpoint) {
  await authFetch(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' });
}