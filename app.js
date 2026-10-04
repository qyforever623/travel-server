const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');

const indexRouter = require('./routes/index');
const travelRouter = require('./routes/travel');

const cors = require('cors');

const app = express();
// 解决跨域
app.use(cors({
  origin: 'https://travel-client-dpq63rf8bd2b.edgeone.dev', // 你的 EdgeOne 域名
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// 2. 显式处理 OPTIONS 预检请求
app.options('*', (req, res) => {
  res.sendStatus(200); // 或者 res.sendStatus(204)
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));




// 路由注册：默认首页路由 + 旅游模块路由
app.use('/', indexRouter);
app.use('/api/travel', travelRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
