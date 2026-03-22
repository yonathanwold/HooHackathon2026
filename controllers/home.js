/**
 * GET /
 * Home page.
 */
exports.index = (req, res) => {
  res.render('home', {
    title: 'Home',
    siteURL: process.env.BASE_URL,
  });
};

/**
 * GET /tacitus
 * Tacitus interactive demo page.
 */
exports.tacitus = (req, res) => {
  res.render('tacitus', {
    title: 'Tacitus Demo',
    siteURL: process.env.BASE_URL,
  });
};

exports.workflow = (req, res) => {
  res.render('workflow', {
    title: 'Workflow',
    siteURL: process.env.BASE_URL,
  });
};

exports.claims = (req, res) => {
  res.render('claims', {
    title: 'Claims',
    siteURL: process.env.BASE_URL,
  });
};

exports.threads = (req, res) => {
  res.render('threads', {
    title: 'Threads',
    siteURL: process.env.BASE_URL,
  });
};

exports.ask = (req, res) => {
  res.render('ask', {
    title: 'Ask Tacitus',
    siteURL: process.env.BASE_URL,
  });
};
