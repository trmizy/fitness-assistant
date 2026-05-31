const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password123';

const PT_FLOW_USERS = [
  {
    email: process.env.PT_REQINFO_EMAIL || 'pt.flow.reqinfo@example.com',
    password: process.env.PT_REQINFO_PASSWORD || 'Test@12345',
    tag: 'REQINFO',
  },
  {
    email: process.env.PT_REJECT_EMAIL || 'pt.flow.reject@example.com',
    password: process.env.PT_REJECT_PASSWORD || 'Test@12345',
    tag: 'REJECT',
  },
  {
    email: process.env.PT_APPROVE_EMAIL || 'pt.flow.approve@example.com',
    password: process.env.PT_APPROVE_PASSWORD || 'Test@12345',
    tag: 'APPROVE',
  },
];

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }

  return {
    status: response.status,
    ok: response.ok,
    body: json,
  };
}

async function login(email, password) {
  const result = await call('/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  return {
    status: result.status,
    ok: result.ok,
    token:
      result.body?.accessToken ||
      result.body?.token ||
      result.body?.data?.accessToken ||
      null,
    user: result.body?.user || result.body?.data?.user || null,
    raw: result.body,
  };
}

async function run() {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!admin.token) {
    console.error(
      JSON.stringify(
        {
          success: false,
          step: 'admin_login',
          message: 'Admin login failed',
          status: admin.status,
          response: admin.raw,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const workflows = await call('/admin/workflows', { token: admin.token });

  const appBuild = [];
  for (const actor of PT_FLOW_USERS) {
    const session = await login(actor.email, actor.password);
    if (!session.token) {
      appBuild.push({
        email: actor.email,
        tag: actor.tag,
        loginStatus: session.status,
        loginOk: false,
      });
      continue;
    }

    await call('/profile/me', {
      method: 'PUT',
      token: session.token,
      body: {
        age: 29,
        gender: 'OTHER',
        heightCm: 170,
        goal: 'MUSCLE_GAIN',
        activityLevel: 'MODERATELY_ACTIVE',
        experienceLevel: 'BEGINNER',
        preferredTrainingDays: [1, 3, 5],
        availableEquipment: ['dumbbells'],
        injuries: [],
      },
    });

    const existing = await call('/pt-applications/me', { token: session.token });
    const canResubmit =
      !existing.body ||
      ['DRAFT', 'NEEDS_MORE_INFO', null].includes(existing.body?.status || null);

    let draft = { status: null, ok: null };
    let submit = { status: null, ok: null };

    if (canResubmit) {
      const suffix = Date.now().toString().slice(-8);
      const draftBody = {
        phoneNumber: `09${suffix}`,
        nationalIdNumber: `ID${suffix}${actor.tag}`,
        currentAddress: 'Ho Chi Minh City',
        idCardFrontUrl: `/uploads/pt-applications/front-${actor.tag}.png`,
        idCardBackUrl: `/uploads/pt-applications/back-${actor.tag}.png`,
        portraitPhotoUrl: `/uploads/pt-applications/portrait-${actor.tag}.png`,
        yearsOfExperience: '3 years',
        serviceMode: 'ONLINE',
        desiredSessionPrice: 350000,
        mainSpecialties: ['weight-loss', 'muscle-gain'],
        professionalBio: `Candidate ${actor.tag}`,
      };

      draft = await call('/pt-applications/me/draft', {
        method: 'POST',
        token: session.token,
        body: draftBody,
      });

      submit = await call('/pt-applications/me/submit', {
        method: 'POST',
        token: session.token,
        body: {},
      });
    }

    const current = await call('/pt-applications/me', { token: session.token });

    appBuild.push({
      email: actor.email,
      tag: actor.tag,
      draftStatus: draft.status,
      submitStatus: submit.status,
      statusAfterSubmit: current.body?.status || null,
      appId: current.body?.id || null,
    });
  }

  const appMap = Object.fromEntries(appBuild.map((item) => [item.tag, item]));

  const reviewCalls = [];
  if (appMap.REQINFO?.appId) {
    reviewCalls.push({
      branch: 'REQUEST_INFO',
      result: await call(`/pt-applications/admin/${appMap.REQINFO.appId}/review/REQUEST_INFO`, {
        method: 'POST',
        token: admin.token,
        body: { adminNote: 'Please provide a clearer certificate scan' },
      }),
    });
  }

  if (appMap.REJECT?.appId) {
    reviewCalls.push({
      branch: 'REJECT',
      result: await call(`/pt-applications/admin/${appMap.REJECT.appId}/review/REJECT`, {
        method: 'POST',
        token: admin.token,
        body: { rejectionReason: 'Certification could not be verified' },
      }),
    });
  }

  if (appMap.APPROVE?.appId) {
    reviewCalls.push({
      branch: 'APPROVE',
      result: await call(`/pt-applications/admin/${appMap.APPROVE.appId}/review/APPROVE`, {
        method: 'POST',
        token: admin.token,
        body: {},
      }),
    });
  }

  const branchToTag = {
    REQUEST_INFO: 'REQINFO',
    REJECT: 'REJECT',
    APPROVE: 'APPROVE',
  };

  const reviewDetails = [];
  for (const review of reviewCalls) {
    const tag = branchToTag[review.branch];
    const id = appMap[tag]?.appId;
    if (!id) continue;

    const detail = await call(`/pt-applications/admin/${id}`, { token: admin.token });
    reviewDetails.push({
      branch: tag,
      appId: id,
      statusCode: review.result.status,
      ok: review.result.ok,
      finalStatus: detail.body?.status || null,
      adminNote: detail.body?.adminNote || null,
      rejectionReason: detail.body?.rejectionReason || null,
    });
  }

  const approvedLogin = await login(
    PT_FLOW_USERS[2].email,
    PT_FLOW_USERS[2].password,
  );

  const output = {
    success: true,
    baseUrl: BASE_URL,
    n8nWorkflowsTest: {
      endpoint: '/admin/workflows',
      status: workflows.status,
      ok: workflows.ok,
      summary: workflows.body?.data
        ? {
            total: workflows.body.data.total,
            active: workflows.body.data.active,
            inactive: workflows.body.data.inactive,
            workflowsIsArray: Array.isArray(workflows.body.data.workflows),
          }
        : null,
      error: workflows.body?.error || null,
    },
    ptApplicationBuild: appBuild,
    ptReviewFlow: reviewDetails,
    approvedUserRoleAfterApprove: approvedLogin.user?.role || null,
    approvedUserLoginStatus: approvedLogin.status,
  };

  console.log(JSON.stringify(output, null, 2));
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        error: String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
