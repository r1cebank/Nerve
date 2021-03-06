(function() {
  var _, crypto, extractor, jsonv, md5, msgpack, urlsafe, uuid, v;

  uuid = require('node-uuid');

  crypto = require('crypto');

  jsonv = require('jsonschema').Validator;

  v = new jsonv();

  msgpack = require('msgpack');

  urlsafe = require('urlsafe-base64');

  _ = require('underscore');

  extractor = require('keyword-extractor');

  md5 = require('MD5');

  module.exports = function(socket, db, winston, raygunClient) {
    var acceptSchema, deleteSchema, editSchema, edituserSchema, emailhashSchema, extractorOptions, kw, loginSchema, postSchema, posts, profiles, reauthSchema, registerSchema, searchbykeySchema, self, whoamiSchema, withdrawSchema;
    profiles = db.collection('profiles');
    posts = db.collection('posts');
    kw = db.collection('keywords');
    self = {};
    self.connect = function() {
      return function() {
        var clientUUID;
        clientUUID = uuid.v1();
        socket.emit('handshake', {
          uuid: clientUUID
        });
        return winston.info('client is connected');
      };
    };
    registerSchema = {
      type: 'object',
      properties: {
        name: {
          type: 'string'
        },
        email: {
          type: 'string'
        },
        profession: {
          type: 'string'
        },
        phone: {
          type: 'string'
        },
        talents: {
          type: 'array'
        },
        uuid: {
          type: 'string'
        },
        pass: {
          type: 'string'
        },
        nonce: {
          type: 'string'
        }
      },
      required: ['name', 'email', 'profession', 'talents', 'uuid', 'pass', 'phone']
    };
    self.register = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, registerSchema);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          winston.info('client request verification passed');
          return profiles.find({
            $or: [
              {
                email: data.email
              }, {
                uuid: data.uuid
              }
            ]
          }).toArray(function(err, docs) {
            var emptyArray, h1, h2, hmac, key, userPass;
            if (docs.length > 0) {
              winston.warn('trying to insert existing user');
              socket.emit('response', {
                code: 201,
                message: 'user exist',
                errorcode: 400,
                successcode: 0,
                data: '',
                nonce: data.nonce
              });
            } else {
              h1 = crypto.createHash('sha256').update(data.uuid).digest('hex');
              h2 = crypto.createHash('sha256').update(new Date().toISOString()).digest('hex');
              key = crypto.createHash('sha256').update(h1 + h2).digest('hex');
              hmac = crypto.createHmac('sha256', key);
              userPass = hmac.update(data.pass).digest('hex');
              emptyArray = [];
              return profiles.insert({
                name: data.name,
                email: data.email,
                phone: data.phone,
                profession: data.profession,
                talents: data.talents,
                accepted: emptyArray,
                uuid: data.uuid,
                password: userPass,
                secret: key
              }, function(err, docs) {
                winston.info("new user inserted :" + data.name + ":" + data.uuid);
                return socket.emit('response', {
                  code: 200,
                  message: 'user created',
                  errorcode: 0,
                  successcode: 300,
                  data: '',
                  nonce: data.nonce
                });
              });
            }
          });
        }
      };
    };

    /*response codes
      200 - OK
      201 - ERROR
    error codes
      400 - USER EXIST
      401 - USER NOT EXIST
      402 - LOGIN ERROR
      403 - TOKEN FORMAT
      404 - AUTH ERROR
      405 - DELETE FAILED
      406 - REQUEST INVALID
      407 - ALTER FAILED
      408 - JOB ACCEPTED
      409 - POST NOT EXIST
      410 - WITHDREW FAILED
    success codes
      300 - USER CREATED
      301 - USER LOGGED IN
      302 - POST CREATED
      303 - QUERY COMPLETE
      304 - POST DELETED
      305 - WHOAMI COMPLETE
      306 - EMAILHASH COMPLETE
      307 - ALTER COMPLETED
      308 - JOB ACCEPT FAILED
      309 - WITHDREW COMPLETE
     */
    self.disconnect = function() {
      return function() {
        return winston.info('client disconnected.');
      };
    };
    self.checkauth = function(token, callback) {
      var _payload, _signature, _time, _uuid, error, meta;
      winston.info('server requested to check authentication');
      if (!urlsafe.validate(token)) {
        socket.emit('response', {
          code: 201,
          message: 'token format validation failed - non urlsafe',
          errorcode: 403,
          successcode: 0,
          data: '',
          nonce: data.nonce
        });
        return callback(null);
      } else {
        try {
          meta = msgpack.unpack(urlsafe.decode(token));
        } catch (_error) {
          error = _error;
          socket.emit('response', {
            code: 201,
            message: 'token format validation failed - non msgpack',
            errorcode: 403,
            successcode: 0,
            data: '',
            nonce: data.nonce
          });
          callback(null);
        }
        if (!_.isArray(meta)) {
          socket.emit('response', {
            code: 201,
            message: 'token format validation failed - non array',
            errorcode: 403,
            successcode: 0,
            data: '',
            nonce: data.nonce
          });
          return callback(null);
        } else {
          _payload = msgpack.pack(meta.slice(0, -1));
          _uuid = meta[0];
          _time = meta[1];
          _signature = meta[2];
          return profiles.findOne({
            uuid: _uuid
          }, function(err, doc) {
            var hash, hmac, user;
            if (!doc) {
              winston.warn('user does not exist');
              socket.emit('response', {
                code: 201,
                message: 'user does not exist',
                errorcode: 401,
                successcode: 0,
                data: '',
                nonce: data.nonce
              });
              return callback(null);
            } else {
              hmac = crypto.createHmac('sha256', doc.secret);
              hash = hmac.update(_payload).digest('hex');
              if (_signature === hash) {
                winston.info('user: ' + doc.name + ' authorized');
                user = {
                  name: doc.name,
                  email: doc.email,
                  phone: doc.phone,
                  accepted: doc.accepted,
                  profession: doc.profession,
                  talents: doc.talents,
                  uuid: doc.uuid
                };
                return callback(user);
              } else {
                winston.warn('user token not match');
                socket.emit('response', {
                  code: 201,
                  message: 'auth error',
                  errorcode: 404,
                  successcode: 0,
                  data: '',
                  nonce: data.nonce
                });
                return callback(null);
              }
            }
          });
        }
      }
    };
    reauthSchema = {
      type: 'object',
      properties: {
        token: {
          type: 'string'
        }
      },
      required: ['token']
    };
    self.reauth = function() {
      return function(data, callback) {
        var _payload, _signature, _time, _uuid, error, meta, vdata;
        vdata = v.validate(data, reauthSchema);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          winston.info('client request verification passed');
          winston.info('client requested reauthentication');
          if (!urlsafe.validate(data.token)) {
            return socket.emit('response', {
              code: 201,
              message: 'token format validation failed - non urlsafe',
              errorcode: 403,
              successcode: 0,
              data: '',
              nonce: data.nonce
            });
          } else {
            try {
              meta = msgpack.unpack(urlsafe.decode(data.token));
            } catch (_error) {
              error = _error;
              socket.emit('response', {
                code: 201,
                message: 'token format validation failed - non msgpack',
                errorcode: 403,
                successcode: 0,
                data: '',
                nonce: data.nonce
              });
            }
            if (!_.isArray(meta)) {
              return socket.emit('response', {
                code: 201,
                message: 'token format validation failed - non array',
                errorcode: 403,
                successcode: 0,
                data: '',
                nonce: data.nonce
              });
            } else {
              _payload = msgpack.pack(meta.slice(0, -1));
              _uuid = meta[0];
              _time = meta[1];
              _signature = meta[2];
              return profiles.findOne({
                uuid: _uuid
              }, function(err, doc) {
                var hash, hmac;
                if (!doc) {
                  winston.warn('user does not exist');
                  return socket.emit('response', {
                    code: 201,
                    message: 'user does not exist',
                    errorcode: 401,
                    successcode: 0,
                    data: '',
                    nonce: data.nonce
                  });
                } else {
                  hmac = crypto.createHmac('sha256', doc.secret);
                  hash = hmac.update(_payload).digest('hex');
                  if (_signature === hash) {
                    winston.info('user: ' + doc.name + ' logged in');
                    return socket.emit('response', {
                      code: 200,
                      message: 'user loggedin',
                      errorcode: 0,
                      successcode: 301,
                      data: data.token,
                      nonce: data.nonce
                    });
                  } else {
                    winston.warn('user password not match');
                    return socket.emit('response', {
                      code: 201,
                      message: 'login error',
                      errorcode: 402,
                      successcode: 0,
                      data: '',
                      nonce: data.nonce
                    });
                  }
                }
              });
            }
          }
        }
      };
    };
    loginSchema = {
      type: 'object',
      properties: {
        email: {
          type: 'string'
        },
        password: {
          type: 'string'
        }
      },
      required: ['email', 'password']
    };
    self.login = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, loginSchema);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          winston.info('client request verification passed');
          winston.info('client trying to login.');
          return profiles.findOne({
            email: data.email
          }, function(err, doc) {
            var hmac, token, userPass;
            if (!doc) {
              winston.warn('user does not exist');
              socket.emit('response', {
                code: 201,
                message: 'user does not exist',
                errorcode: 401,
                successcode: 0,
                data: '',
                nonce: data.nonce
              });
            } else {
              hmac = crypto.createHmac('sha256', doc.secret);
              userPass = hmac.update(data.password).digest('hex');
              if (userPass === doc.password) {
                winston.info('user: ' + doc.name + ' logged in');
                token = self.createToken({
                  uuid: doc.uuid,
                  secret: doc.secret
                });
                return socket.emit('response', {
                  code: 200,
                  message: 'user loggedin',
                  errorcode: 0,
                  successcode: 301,
                  data: token,
                  nonce: data.nonce
                });
              } else {
                winston.warn('user password not match');
                return socket.emit('response', {
                  code: 201,
                  message: 'login error',
                  errorcode: 402,
                  successcode: 0,
                  data: '',
                  nonce: data.nonce
                });
              }
            }
          });
        }
      };
    };

    /*
    {
      title: '',
      description: '',
      date: '', tags:'',
      skills:'',comp: '',
      location:'',
      expire:'',
      remarks:'',
      accessToken:'', uuid:''
    }
     */
    deleteSchema = {
      type: 'object',
      properties: {
        token: {
          type: 'string'
        },
        postid: {
          type: 'string'
        }
      },
      required: ['token', 'postid']
    };
    self["delete"] = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, deleteSchema);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          winston.info('client request verification passed');
          winston.info('user delete post');
          return self.checkauth(data.token, function(user) {
            if (user) {
              winston.info('user ' + user.name + ' requested to delete ' + data.postid);
              return posts.remove({
                postid: data.postid,
                uuid: user.uuid
              }, function(err, result) {
                if (result) {
                  winston.info("post deleted: " + data.postid);
                  socket.emit('response', {
                    code: 200,
                    message: 'post deleted',
                    errorcode: 0,
                    successcode: 304,
                    data: '',
                    nonce: data.nonce
                  });
                } else {
                  winston.info("post delete failed: " + data.postid);
                  socket.emit('response', {
                    code: 201,
                    message: 'post delete failed',
                    errorcode: 0,
                    successcode: 405,
                    data: '',
                    nonce: data.nonce
                  });
                }
                if (err) {
                  raygunClient(err);
                  return winston.error(err);
                }
              });
            }
          });
        }
      };
    };
    extractorOptions = {
      language: "english",
      remove_digits: true,
      return_changed_case: true
    };
    postSchema = {
      type: 'object',
      properties: {
        title: {
          type: 'string'
        },
        description: {
          type: 'string'
        },
        skills: {
          type: 'array'
        },
        comp: {
          type: 'number'
        },
        duration: {
          type: 'number'
        },
        location: {
          type: 'object'
        },
        remarks: {
          type: 'string'
        },
        token: {
          type: 'string'
        }
      },
      required: ['token', 'remarks', 'location', 'comp', 'skills', 'description', 'title', 'duration']
    };
    editSchema = {
      type: 'object',
      properties: {
        data: {
          type: 'string'
        },
        type: {
          type: 'string'
        },
        postid: {
          type: 'string'
        },
        token: {
          type: 'string'
        }
      },
      required: ['token', 'data', 'type', 'postid']
    };
    self.edit = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, editSchema);
        console.log(vdata);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          return self.checkauth(data.token, function(user) {
            var query;
            if (user) {
              winston.info('user ' + user.name + ' requested to delete ' + data.postid);
              query = {};
              query[data.type] = data.data;
              return posts.update({
                postid: data.postid,
                uuid: user.uuid
              }, {
                $set: query
              }, function(err, result) {
                if (result) {
                  winston.info("post altered: " + data.postid);
                  socket.emit('response', {
                    code: 200,
                    message: 'post altered',
                    errorcode: 0,
                    successcode: 307,
                    data: '',
                    nonce: data.nonce
                  });
                } else {
                  winston.info("post alter failed: " + data.postid);
                  socket.emit('response', {
                    code: 201,
                    message: 'post alter failed',
                    errorcode: 0,
                    successcode: 407,
                    data: '',
                    nonce: data.nonce
                  });
                }
                if (err) {
                  raygunClient(err);
                  return winston.error(err);
                }
              });
            }
          });
        }
      };
    };
    edituserSchema = {
      type: 'object',
      properties: {
        data: {
          type: 'string'
        },
        type: {
          type: 'string'
        },
        token: {
          type: 'string'
        }
      },
      required: ['token', 'data', 'type']
    };
    self.editprofile = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, edituserSchema);
        console.log(vdata);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          return self.checkauth(data.token, function(user) {
            var query;
            if (user) {
              winston.info('user ' + user.name + ' requested to alter profile' + user.postid);
              query = {};
              query[data.type] = data.data;
              return profiles.update({
                uuid: user.uuid
              }, {
                $set: query
              }, function(err, result) {
                if (result) {
                  winston.info("profile altered: " + data.uuid);
                  socket.emit('response', {
                    code: 200,
                    message: 'profile altered',
                    errorcode: 0,
                    successcode: 307,
                    data: '',
                    nonce: data.nonce
                  });
                } else {
                  winston.info("profile alter failed: " + data.uuid);
                  socket.emit('response', {
                    code: 201,
                    message: 'profile alter failed',
                    errorcode: 0,
                    successcode: 407,
                    data: '',
                    nonce: data.nonce
                  });
                }
                if (err) {
                  raygunClient(err);
                  return winston.error(err);
                }
              });
            }
          });
        }
      };
    };
    acceptSchema = {
      type: 'object',
      properties: {
        postid: {
          type: 'string'
        },
        token: {
          type: 'string'
        }
      },
      required: ['token', 'postid']
    };
    self.accept = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, acceptSchema);
        console.log(vdata);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          return self.checkauth(data.token, function(user) {
            if (user) {
              winston.info('user ' + user.name + ' requested to accept job' + user.postid);
              return posts.find({
                postid: data.postid
              }).toArray(function(err, docs) {
                var query;
                if (docs.length < 1) {
                  winston.warn('post does not exist');
                  socket.emit('response', {
                    code: 201,
                    message: 'post does not exist',
                    errorcode: 409,
                    successcode: 0,
                    data: '',
                    nonce: data.nonce
                  });
                } else {
                  if (_.indexOf(user.accepted, data.postid) !== -1) {
                    socket.emit('response', {
                      code: 201,
                      message: 'job accepted failed - uuid exists',
                      errorcode: 0,
                      successcode: 408,
                      data: '',
                      nonce: data.nonce
                    });
                    return;
                  }
                  user.accepted.push(data.postid);
                  query = {};
                  query['accepted'] = user.accepted;
                  return profiles.update({
                    uuid: user.uuid
                  }, {
                    $set: query
                  }, function(err, result) {
                    if (result) {
                      winston.info("job accepted: " + data.postid);
                      socket.emit('response', {
                        code: 200,
                        message: 'job accepted',
                        errorcode: 0,
                        successcode: 308,
                        data: '',
                        nonce: data.nonce
                      });
                    } else {
                      winston.info("job accepted: " + data.postid);
                      socket.emit('response', {
                        code: 201,
                        message: 'job accepted failed',
                        errorcode: 0,
                        successcode: 408,
                        data: '',
                        nonce: data.nonce
                      });
                    }
                    if (err) {
                      raygunClient(err);
                      return winston.error(err);
                    }
                  });
                }
              });
            }
          });
        }
      };
    };
    self.post = function() {
      return function(data) {
        var keywords, user, vdata;
        vdata = v.validate(data, postSchema);
        console.log(vdata);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          winston.info('client request verification passed');
          winston.info('user post');
          keywords = extractor.extract(data.description, extractorOptions);
          winston.info('keywords:');
          winston.info(keywords);
          return user = self.checkauth(data.token, function(user) {
            var endDate, expire, i, len, word;
            if (user) {
              winston.info('user ' + user.name + ' authorized to post');
              expire = new Date();
              expire.setDate(expire.getDate() + 7);
              endDate = new Date();
              endDate.setDate(endDate.getDate() + data.duration);
              if (expire < endDate) {
                expire.setDate(endDate.getDate() + 7);
              }
              for (i = 0, len = keywords.length; i < len; i++) {
                word = keywords[i];
                kw.insert({
                  keyword: word,
                  hitrate: 0
                }, function(err, docs) {
                  return winston.info("keywords inserted successfully.");
                });
              }
              return posts.insert({
                title: data.title,
                description: data.description,
                date: new Date(),
                endDate: endDate,
                tags: keywords,
                skills: data.skills,
                comp: data.comp,
                location: data.location,
                expire: expire,
                remarks: data.remarks,
                uuid: user.uuid,
                postid: uuid.v1()
              }, function(err, docs) {
                winston.info("new post inserted: " + data.title + ": " + data.loc);
                return socket.emit('response', {
                  code: 200,
                  message: 'post created',
                  errorcode: 0,
                  successcode: 302,
                  data: '',
                  nonce: data.nonce
                });
              });
            } else {
              winston.warn('user not authorized or authentication failed');
              return socket.emit('response', {
                code: 201,
                message: 'authentication failed - auth failed',
                errorcode: 404,
                successcode: 0,
                data: '',
                nonce: data.nonce
              });
            }
          });
        }
      };
    };
    searchbykeySchema = {
      type: 'object',
      properties: {
        keywords: {
          type: 'array'
        }
      },
      required: ['keywords']
    };
    self.searchbykey = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, searchbykeySchema);
        console.log(vdata);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          return posts.find({
            tags: {
              $all: data.keywords
            }
          }).toArray(function(err, docs) {
            return socket.emit('response', {
              code: 200,
              message: 'search data',
              errorcode: 0,
              successcode: 303,
              data: docs,
              nonce: data.nonce
            });
          });
        }
      };
    };
    emailhashSchema = {
      type: 'object',
      properties: {
        uuid: {
          type: 'string'
        }
      },
      required: ['uuid']
    };
    self.emailhash = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, emailhashSchema);
        console.log(vdata);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          return profiles.findOne({
            uuid: data.uuid
          }, function(err, doc) {
            if (!doc) {
              winston.warn('user does not exist');
              socket.emit('response', {
                code: 201,
                message: 'user does not exist',
                errorcode: 401,
                successcode: 0,
                data: '',
                nonce: data.nonce
              });
            } else {
              return socket.emit('response', {
                code: 200,
                message: 'user does not exist',
                errorcode: 0,
                successcode: 306,
                data: md5(doc.email),
                nonce: data.nonce
              });
            }
          });
        }
      };
    };
    self.queryall = function() {
      return function(data) {
        return posts.find({}).toArray(function(err, docs) {
          return socket.emit('response', {
            code: 200,
            message: 'all data',
            errorcode: 0,
            successcode: 303,
            data: docs,
            nonce: data != null ? data.nonce : void 0
          });
        });
      };
    };
    whoamiSchema = {
      type: 'object',
      properties: {
        token: {
          type: 'string'
        }
      },
      required: ['token']
    };
    self.whoami = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, whoamiSchema);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          winston.info('client request verification passed');
          return self.checkauth(data.token, function(user) {
            if (user) {
              user.emailhash = md5(user.email);
              return socket.emit('response', {
                code: 200,
                message: 'whoami query',
                errorcode: 0,
                successcode: 305,
                data: user,
                nonce: data.nonce
              });
            }
          });
        }
      };
    };
    withdrawSchema = {
      type: 'object',
      properties: {
        postid: {
          type: 'string'
        },
        token: {
          type: 'string'
        }
      },
      required: ['token', 'postid']
    };
    self.withdraw = function() {
      return function(data) {
        var vdata;
        vdata = v.validate(data, acceptSchema);
        console.log(vdata);
        if (vdata.errors.length > 0) {
          winston.error('client input invalid');
          socket.emit('response', {
            code: 201,
            message: 'request invalid',
            errorcode: 406,
            successcode: 0,
            data: vdata.errors[0].message,
            nonce: data.nonce
          });
        } else {
          return self.checkauth(data.token, function(user) {
            var query;
            if (user) {
              winston.info('user ' + user.name + ' requested to withdraw job' + user.postid);
              if (_.indexOf(user.accepted, data.postid) === -1) {
                winston.warn('post does not exist');
                socket.emit('response', {
                  code: 201,
                  message: 'post does not exist',
                  errorcode: 409,
                  successcode: 0,
                  data: '',
                  nonce: data.nonce
                });
              } else {
                query = {};
                user.accepted.splice(_.indexOf(user.accepted, data.postid), 1);
                query['accepted'] = user.accepted;
                return profiles.update({
                  uuid: user.uuid
                }, {
                  $set: query
                }, function(err, result) {
                  if (result) {
                    winston.info("job withdrew: " + data.postid);
                    socket.emit('response', {
                      code: 200,
                      message: 'job withdrew',
                      errorcode: 0,
                      successcode: 309,
                      data: '',
                      nonce: data.nonce
                    });
                  } else {
                    winston.info("job withdrew: " + data.postid);
                    socket.emit('response', {
                      code: 201,
                      message: 'job withdrew failed',
                      errorcode: 0,
                      successcode: 410,
                      data: '',
                      nonce: data.nonce
                    });
                  }
                  if (err) {
                    raygunClient(err);
                    return winston.error(err);
                  }
                });
              }
            }
          });
        }
      };
    };
    self.ping = function() {
      return function() {
        return winston.info('recieved ping from MotionDex/Mocha, keep alive.');
      };
    };
    self.createToken = function(user) {
      var hash, hmac, meta, payload, time;
      time = Math.floor(new Date().getTime() / 1000);
      meta = [user.uuid, time];
      payload = msgpack.pack(meta);
      hmac = crypto.createHmac('sha256', user.secret);
      hash = hmac.update(payload).digest('hex');
      meta.push(hash);
      return urlsafe.encode(msgpack.pack(meta));
    };
    self.error = function() {
      return function(error) {
        if (process.env.PRODUCTION != null) {
          raygunClient.send(error);
        }
        winston.error(error);
        return socket.disconnect();
      };
    };
    return self;
  };

}).call(this);
