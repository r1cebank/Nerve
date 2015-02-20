uuid = require 'node-uuid'
crypto = require 'crypto'
#jsonv = require 'jsonschema'.Validator
msgpack = require 'msgpack'
urlsafe = require 'urlsafe-base64'
_       = require('underscore')

##NO INPUT VALIDATION

module.exports = (socket,db, winston) ->

  profiles = db.collection('profiles')
  posts = db.collection('posts')

  self = { }

  self.connect = ->
    ->
      clientUUID = uuid.v1()
      socket.emit 'handshake',
        uuid: clientUUID
      winston.info 'client is connected'

  self.register = ->
    (data) ->
      #check against existing email

      profiles.find($or: [{email: data.email}, {uuid: data.uuid}])
      .toArray (err, docs) ->
        if docs.length > 0
          winston.warn 'trying to insert existing user'
          socket.emit 'response',
            code: 201
            message: 'user exist'
            errorcode: 400
            successcode: 0
            data: ''
          return
        else
          h1 = crypto.createHash 'sha256'
            .update data.uuid
            .digest 'hex'
          h2 = crypto.createHash 'sha256'
            .update new Date().toISOString()
            .digest 'hex'
          key = crypto.createHash 'sha256'
            .update h1 + h2
            .digest 'hex'
          hmac = crypto.createHmac 'sha256', key
          userPass = hmac.update(data.pass).digest('hex')
          profiles.insert
            name:         data.name
            email:        data.email
            profession:   data.profession
            talents:      data.talents
            uuid:         data.uuid
            password:     userPass
            secret:       key
            , (err, docs) ->
              winston.info 'new user inserted :#{data.name}:#{data.uuid}'
              socket.emit 'response',
                code: 200
                message: 'user created'
                errorcode: 0
                successcode: 300
                data: ''

  ###response codes
    200 - OK
    201 - ERROR
  error codes
    400 - USER EXIST
    401 - USER NOT EXIST
    402 - LOGIN ERROR
    403 - TOKEN FORMAT
  success codes
    300 - USER CREATED
    301 - USER LOGGED IN
  ###

  self.disconnect = ->
    ->
      winston.info 'client disconnected.'

  self.reauth = ->
    (data) ->
      winston.info 'client requested reauthentication'
      if not urlsafe.validate data.token
        socket.emit 'response',
          code: 201,
          message: 'token format validation failed - non urlsafe',
          errorcode: 403,
          successcode: 0,
          data: ''
      else
        meta = msgpack.unpack urlsafe.decode data.token
        if not _.isArray(meta)
          socket.emit 'response',
            code: 201,
            message: 'token format validation failed - non array',
            errorcode: 403,
            successcode: 0,
            data: ''
        else
          _payload = msgpack.pack(meta.slice(0,-1))
          _uuid = meta[0]
          _time = meta[1]
          _signature = meta[2]
          profiles.findOne uuid: _uuid, (err, doc) ->
            if !doc
              winston.warn 'user does not exist'
              socket.emit 'response',
                code: 201
                message: 'user does not exist'
                errorcode: 401
                successcode: 0
                data: ''
              return
            else
              hmac = crypto.createHmac 'sha256', doc.secret
              hash = hmac.update(_payload).digest('hex')
              if _signature is hash
                winston.info 'user: ' + doc.name + ' logged in'
                token = self.createToken uuid: doc.uuid, secret: doc.secret
                socket.emit 'response',
                  code: 200
                  message: 'user loggedin'
                  errorcode: 0
                  successcode: 301
                  data: data.token
              else
                winston.warn 'user password not match'
                socket.emit 'response',
                  code: 201
                  message: 'login error'
                  errorcode: 402
                  successcode: 0
                  data: ''


  self.login = ->
    (data) ->
      winston.info 'client trying to login.'
      profiles.findOne email: data.email, (err, doc) ->
        if !doc
          winston.warn 'user does not exist'
          socket.emit 'response',
            code: 201
            message: 'user does not exist'
            errorcode: 401
            successcode: 0
            data: ''
          return
        else
          hmac = crypto.createHmac 'sha256', doc.secret
          userPass = hmac.update(data.password).digest('hex')
          if userPass is doc.password
            winston.info 'user: ' + doc.name + ' logged in'
            token = self.createToken uuid: doc.uuid, secret: doc.secret
            socket.emit 'response',
              code: 200
              message: 'user loggedin'
              errorcode: 0
              successcode: 301
              data: token
          else
            winston.warn 'user password not match'
            socket.emit 'response',
              code: 201
              message: 'login error'
              errorcode: 402
              successcode: 0
              data: ''


  self.post = ->
    (data) ->
      winston.info 'user post'

  self.ping = ->
    ->
      winston.info 'recieved ping from MotionDex/Mocha, keep alive.'

  self.createToken = (user) ->
    time = Math.floor(new Date().getTime() / 1000)
    meta = [user.uuid, time]
    payload = msgpack.pack meta
    hmac = crypto.createHmac 'sha256', user.secret
    hash = hmac.update(payload).digest('hex')
    meta.push hash
    urlsafe.encode msgpack.pack meta
  self.error = ->
    (error) ->
      if process.env.PRODUCTION
        raygunClient.send error
      winston.error error

  return self