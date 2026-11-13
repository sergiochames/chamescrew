// Chames Crew — contas de aluno criadas pelo personal e o "resgate" pelo link de acesso.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const code6 = () => { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c = ""; for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)]; return c; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const adm = createClient(URL_, SR, { auth: { persistSession: false } });
    const act = body.action;

    if (act === "claim") {
      const code = String(body.code || "").toUpperCase().trim(), pw = String(body.password || "");
      let email = String(body.email || "").trim().toLowerCase();
      const { data: inv } = await adm.from("invites").select("*").eq("code", code).is("used_by", null).maybeSingle();
      if (!inv || !inv.profile_id) return out({ error: "Esse link já foi usado ou não existe. Peça um novo ao seu personal." }, 400);
      // conta que já tem e-mail de verdade: o link só troca a senha (o e-mail continua o mesmo)
      const { data: cur } = await adm.auth.admin.getUserById(inv.profile_id);
      const curEmail = (cur && cur.user && cur.user.email) || "";
      if (curEmail && !curEmail.endsWith("@sem-email.chamescrew.app")) email = curEmail;
      if (!code || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || pw.length < 6) return out({ error: "Confira o e-mail e a senha (mínimo 6 caracteres)." }, 400);
      const { error } = await adm.auth.admin.updateUserById(inv.profile_id, { email, password: pw, email_confirm: true });
      if (error) return out({ error: /already|registered|exists/i.test(error.message) ? "Esse e-mail já tem conta. Use outro ou entre com ele." : error.message }, 400);
      await adm.from("invites").update({ used_by: inv.profile_id }).eq("code", code);
      return out({ ok: true, email });
    }

    // daqui pra baixo: só a equipe
    const auth = req.headers.get("Authorization") || "";
    const usr = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user } } = await usr.auth.getUser();
    if (!user) return out({ error: "Sem sessão." }, 401);
    const { data: me } = await adm.from("profiles").select("role").eq("id", user.id).single();
    if (!me || me.role !== "equipe") return out({ error: "Só a equipe." }, 403);

    if (act === "create") {
      const name = String(body.name || "").trim();
      if (!name) return out({ error: "Nome obrigatório." }, 400);
      const fake = `a-${crypto.randomUUID().slice(0, 12)}@sem-email.chamescrew.app`;
      const { data: cu, error } = await adm.auth.admin.createUser({ email: fake, password: crypto.randomUUID(), email_confirm: true, user_metadata: { name } });
      if (error || !cu.user) return out({ error: error?.message || "Falhou" }, 400);
      const id = cu.user.id;
      const up: Record<string, unknown> = { role: "aluno", name, phone: body.phone || null, plan: body.plan || "treino", freq: body.freq || null,
        access_until: body.access_until || null, cycle_day: body.cycle_day || null, presencial: body.presencial ?? true, onboarded: false };
      await adm.from("profiles").update(up).eq("id", id);
      let c = /^[A-Z0-9]{6}$/.test(String(body.code || "")) ? String(body.code) : code6();
      for (let k = 0; k < 5; k++) { const { error: e2 } = await adm.from("invites").insert({ code: c, name, phone: body.phone || null, plan: body.plan || "treino", created_by: user.id, profile_id: id }); if (!e2) break; c = code6(); }
      return out({ ok: true, id, code: c });
    }
    if (act === "newcode") {
      await adm.from("invites").delete().eq("profile_id", body.id).is("used_by", null);
      const { data: p } = await adm.from("profiles").select("name,phone,plan").eq("id", body.id).single();
      let c = code6();
      for (let k = 0; k < 5; k++) { const { error: e2 } = await adm.from("invites").insert({ code: c, name: p?.name, phone: p?.phone, plan: p?.plan || "treino", created_by: user.id, profile_id: body.id }); if (!e2) break; c = code6(); }
      return out({ ok: true, code: c });
    }
    if (act === "delete") {
      const { data: p } = await adm.from("profiles").select("role").eq("id", body.id).single();
      if (!p || p.role !== "aluno") return out({ error: "Não é aluno." }, 400);
      await adm.auth.admin.deleteUser(body.id);
      return out({ ok: true });
    }
    return out({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return out({ error: String((e as Error).message || e) }, 500);
  }
});
