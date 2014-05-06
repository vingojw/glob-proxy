var http = require('http');
var fs = require('fs');
var url = require('url');
var Mock = require("mockjs");
var path = require('path');
var net = require('net');
var buffer = require('buffer');

var Guider = function(config){
    var self = this;
    self.config = config;
    self.REQUEST = config.REQUEST;
    self.ROOT = config.ROOT || null;
    /**
    *   TYPE 类型用于支持HTTP SOAP TCP 代理 未来支持SOAP TCP协议
    *   PORT 初始化请求端口
    *   ROOT ROOT目录 用于读取本地文件时的根目录
    *   REQUEST 请求映射
    *   常规HTTP请求配置：GET POST PUT DELETE | SOAP请求也配置在REQUEST中
    *   STATIC_DIR 配置静态资源服务器目标目录
    *   STATIC_DIR_CONFIG 配置静态服务器端口
    *   MOCK 是否开启mock.js
    */
}
Guider.prototype.start = function(){
    var self = this;
    console.log('start server 127.0.0.1',this.config.PORT);
    var server = http.createServer(function(request,response){
            self.request = request;
            self.response = response;
            var result = self.handler();
            result.local ? self.staticFileService(result) : self.proxy(result);
    }).listen(this.config.PORT);
}
Guider.prototype.handler = function(){
    var self = this;
    var parse = url.parse(this.request.url,true);
    var name = parse.pathname;
    if(name !== '/favicon.ico'){
        var result = {'type':'HTTP','name':name};
        //识别请求类型，并对请求进行分析与序列化
        this.requeParse(result,parse);
    }
    return result;
}
Guider.prototype.proxy = function(result){
    switch(result.type){
        case 'HTTP':
            this.HTTP(result);
            break
        case 'SOAP':
            this.SOAP(result);
            break
    }
}
Guider.prototype.HTTP = function(result){
    var method = result.method;
    var self = this;
    switch(method){
        case 'GET':
            util.get.call(self,result);
            break
        case 'POST':
            //根据请求方法 对提交的值进行重新装载
            var data = '';
            this.request.addListener('data',function(box){
                data += box;
            });
            this.request.addListener('end',function(){
                result.body = data;
                util.post.call(self,result);
            });
            break
    }
}
Guider.prototype.SOAP = function(result){
    console.log(result);
}
Guider.prototype.requeParse = function(result,parse){
    var query,local = false,search = parse.search;
    if(search.length){
        query = parse.query;
        local = parseInt(query.local,10);
        //请求序列化参数
        result.query = query;
    }
    //通过local属性识别，发送代理请求，还是读取本地文件 false为代理请求，true为读取本地文件
    result.local = local ? true : false;
    //根据头信息进行代理提交
    result.headers = this.request.headers;
    //分析真实请求method
    result.method = result.headers['access-control-request-method'] || this.request.method;
    //生成真实本地文件目录地址或远程代理地址
    if(this.config.TYPE === 'HTTP'){
        result.URL = result.local ? path.join(this.ROOT,this.REQUEST[result.method][result.name]) : this.REQUEST[result.method][result.name];
    }
    if(this.config.TYPE === 'SOAP'){
        result.URL = this.REQUEST.SOAP[result.name];
        result.type = 'SOAP';
    }
    //请求&参数
    result.search = search;
    //请求不代理读本地文件时返回的状态码 true为文件准备就绪 false为文件不存在或没有权限读取此文件
    result.status = false;
    if(local){
        try{
            var stat = fs.statSync(result.URL);
            result.status = (stat && stat.isFile()) ? true : false;
        }catch(e){
            console.log('文件无法读取，error:可能文件不存在，或没有权限读取此文件');
        }
    }
}
Guider.prototype.error = function(){
    var response = this.response;
    this.responseHeader();
    response.end("<h1>this request is 404 or handler is bad</h1>");
}
Guider.prototype.responseHeader = function(){
    this.response.writeHead('200',{
        'Access-Control-Allow-Headers':'Content-Type, Accept',
        'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Origin':'*',
        'Access-Control-Max-Age':30 * 24 * 3600
    });
}
Guider.prototype.staticFileService = function(result){
    var self = this;
    if(!result.status){
        this.error();
        return false;
    }
    fs.readFile(result.URL,'utf-8', function(err, template) {
        var json = {};
        try{
            json = self.config.MOCK ? Mock.mock(JSON.parse(template)) : JSON.parse(template);
        }catch(e){
            self.error();
        }
        self.responseHeader();
        self.response.end(JSON.stringify(json, null, 4),'utf-8');
    });
}
var extend = function(obj,of){
    for(var k in obj){
        of[k] = obj[k];
    }
    return of;
}
var util = {
    get:function(options){
        var self = this;
        var URL = options.URL + (options.search ||'');
        http.get(URL, function(response) {
            var data = '';
            response.on('data',function(d) {
                data += d;
            });
            response.on('end',function(){
                var buf = new buffer.Buffer(data,'utf-8');
                self.responseHeader();
                self.response.end(buf.toString('utf-8'));
            });
        }).on('error', function(e) {
            console.log("Got error: " + e.message);
        });
    },
    post:function(options){
        var self = this;
        var urlParse = url.parse(options.URL);
        var headers = extend({
            "Content-Length":options.body.length,
            "host":urlParse.host
        },options.headers);
        var optionsParam = {
            method:options.method,
            port:urlParse.port || 80,
            host:urlParse.host,
            path:urlParse.pathname,
            headers:headers
        }
        var reque = http.request(optionsParam,function(response){
            var body = "";
            response.setEncoding('utf8');
            response.on("data",function(chunk){
                body += chunk;
            });
            response.on("end",function(){
                self.responseHeader();
                self.response.end(body,'utf-8');
            });
        });
        reque.on('error',function(e){
            console.log('problem with request :' + e.message)
        });
        reque.write(options.body);
        reque.end();
    }
}
var glob = module.exports = {};
glob.Config = function(config){
    var app = new Guider(config);
    app.start();
}