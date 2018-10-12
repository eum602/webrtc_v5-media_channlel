var videoSelect = document.getElementById("videoSelect")
var audioSelect = document.getElementById("audioSelect")
const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
var startVideo = document.querySelector("#startVideo")
var myVideoArea = document.querySelector("#myVideoTag");
var theirVideoArea = document.querySelector("#theirVideoTag");
var myName = document.querySelector('#myName')
var myMessage = document.querySelector('#myMessage')
var sendMessage = document.querySelector('#sendMessage')
var chatArea = document.querySelector('#chatArea')
var signalingArea = document.querySelector("#signalingArea")
var sendFile = document.querySelector("input#sendFile")
var fileProgress = document.querySelector("progress#fileProgress")
var downloadLink = document.querySelector('a#receivedFileLink')
var ROOM = prompt('type a room name')//"chat";//ROOM = prompt('type a room name') -->si pongo esto
var SIGNAL_ROOM = "signal_room"
var FILES_ROOM = "files"
var created = false
let localStream
const offerOptions = {
    offerToReceiveVideo: 1,
    offerToReceiveAudio:1
    };
callButton.disabled = true;
hangupButton.disabled = true;
var rtcPeerConn
var constraints0 =  {
    audio:false,
    video : {
        mandatory:{
            minWidth:320,
            maxWidth:320,
            minHeight:180,
            maxHeight:180
        }
    }
}
var constraints =  {
    audio:true,
    video : {
        mandatory:{
            minWidth:320,
            maxWidth:320,
            minHeight:180,
            maxHeight:180
        }
    }
}
const servers = {
    'iceServers':[{
        'url':'stun:stun.l.google.com:19302'
    },{'url': 'stun:stun.services.mozilla.com'}]
};
let isCaller = false
let startTime = null
let ices = []
let icesReq = []
var dataChannelOptions = {
    ordered: true//false, //not guaranteed delivery, unreliable but faster
    //maxRetransmitTime:  1000 //miliseconds
}
var sendDataChannel;
var catchDataChannel;
var receivedFileName
var receivedFileSize
var fileBuffer = []
var fileSize = 0
/////////////////////////eventlisteners////////////////////////////////////////////////////
startButton.addEventListener('click', start);
callButton.addEventListener('click', callAction);
hangupButton.addEventListener('click', hangupAction);
myVideoArea.addEventListener('loadedmetadata', logVideoLoaded);
theirVideoArea.addEventListener('loadedmetadata', logVideoLoaded);
theirVideoArea.addEventListener('onresize', logResizedVideo);
sendFile.addEventListener('change',function(ev){
    var file = sendFile.files[0];
    displaySignalMessage("sending file " + file.name + "(" + file.size + "...)"  )
    io.emit('files',{"filename":file.name,"filesize":file.size,"room":FILES_ROOM})            
    fileProgress.max = file.size
    var chunkSize = 0;
    if(file.size<16384){
        chunkSize = file.size
    }else{
        chunkSize = 16384//kilobytes
    }
    console.log("chunksize is: ",chunkSize)
    var sliceFile = function(offset){
        var reader  = new window.FileReader()//using filereader library to slice the file
        //into 16384 file chunks
        reader.onload = (function(){
            return function(e){
                sendDataChannel.send(e.target.result)//sending each chunk individually over the webrtc
                //channel
                if  (file.size > offset + e.target.result.byteLength){
                    window.setTimeout(sliceFile,0,offset + chunkSize)
                }
                fileProgress.value = offset + e.target.result.byteLength                    
            }//updating the fileProgress bar with the number of bytes sent up to this point.
        })(file)
        var slice = file.slice(offset , offset + chunkSize)
        reader.readAsArrayBuffer(slice);
    }
    sliceFile(0)
},false);
///////////////////////////////////sockets()...sendMesage//////////////////////////////////////////////////
sendMessage.addEventListener('click',function(ev){
    io.emit('send',{"author":myName.value,"message":myMessage.value,"room":ROOM})
    //dataChannel.send(myName.value + " says " + myMessage.value );
    ev.preventDefault();
},false);
/////////////////////////////////sockets()...init//////////////////////////////////////////////////////////
io = io.connect();
console.log('io',io)
/////////////////////////////////sockets()...emit ready//////////////////////////////////////////////////////////
io.emit('ready',{"chat_room":ROOM,"signal_room":SIGNAL_ROOM,"files_room":FILES_ROOM});
//io.emit('signal',{"type":"user_here","message":"Are you ready for a call?","room":SIGNAL_ROOM})
/////////////////////////////////sockets()...listener files///////////////////////////////////////////////////////
io.on('files',function(data){                 
    receivedFileName = data.filename
    receivedFileSize =data.filesize
    fileProgress.max = receivedFileSize
    displaySignalMessage("Websockets says the file is on  it's way is " + receivedFileName + 
    "(" + receivedFileSize + ")" );
    displaySignalMessage("Channel is " + catchDataChannel.readyState)
})
///////////////////////////////sockets() ... listener message////////////////////////////////////////////
io.on('message',function(data){
    displayMessage(data.author + " > " + data.message);
})//me mantengo escuchando si desde este route me llega algo
/////////////////////////////////sockets()...listener signaling/////////////////////////////////////////////////
io.on('signaling_message', async (data)=>{
    console.log("data",data)
    displaySignalMessage("data type: " + data.type)
    if (!rtcPeerConn) setPc();
    try {
        if (data.type=="SDP") {
            var a = JSON.parse(data.message)
            var desc = a.sdp
            console.log("desc: ",desc)
            var c = desc.type                    
            displaySignalMessage('working on sdp type ' + c)
            // if we get an offer, we need to reply with an answer
            if (c === 'offer') {
                displaySignalMessage("Entering to define an answer because of offer input..")
                await rtcPeerConn.setRemoteDescription(desc).then(r=>{
                    displaySignalMessage("Remote description stored")
                }).catch(e=>{
                    displaySignalMessage('error setting remote description ' + e.name)
                    console.log("Error setting remote description: ", e)
                });
                await rtcPeerConn.setLocalDescription(await rtcPeerConn.createAnswer()).then(r=>{
                    displaySignalMessage("Created Local description")
                }).catch(e=>
                {displaySignalMessage("Error setting local description when receiving an offer: " + e.name)});
                console.log('local description-answer: ',rtcPeerConn.localDescription)
                sendLocalDesc(rtcPeerConn.localDescription)                        
            } else if (c === 'answer') {
                displaySignalMessage("Entering to store the answer remote description..")
                await rtcPeerConn.setRemoteDescription(desc).then(r=>{
                    displaySignalMessage("Remote answer stored")
                    console.log("Remote answer stored :",rtcPeerConn.remoteDescription)                            
                }).catch(e=>{                        
                  displaySignalMessage('error setting remote descrition: '+ e.name)
                  console.log('error setting remote descrition: ', e)
                });                       
            } else {
                console.log('Unsupported SDP type.');
            }
        } else if (data.type === "ice candidate") {
            displaySignalMessage("Adding foreign Ice candidate..")
            var m = JSON.parse(data.message)
            ice = m.candidate
            console.log('ice candidate: ',ice)                
            ices.push(ice)
        } else if(ices.length>0 && data.type ==="noIce"){
                displaySignalMessage("All candidates received, now starting to send my candidates..")
                ices.forEach(ice=>{
                    rtcPeerConn.addIceCandidate(ice).then(r=>{
                        displaySignalMessage('added a foreign candidate')
                    }).catch(e => {
                    displaySignalMessage("3. Failure during addIceCandidate(): " + e.name)
                    console.log('error adding iceCandidate: ', e)
                    })
                })
                if(!isCaller){
                }
            }
         else if(data.type ==="endCall"){
            rtcPeerConn.close()
            if(sendDataChannel){
                sendDataChannel.close()
                sendDataChannel = null
            }
            if(catchDataChannel){
                catchDataChannel.close()
                catchDataChannel = null
            }
            rtcPeerConn = null;
            sendFile.disabled = true
            icesReq = []
            hangupButton.disabled = true;
            callButton.disabled = false;
        }
    } catch (err) {
        displaySignalMessage("error on signaling message: " + err.name);
        console.log("error on signaling message: " , err)
    }
})
///////////////////////////////start()///////////////////////////////////////////////////////////////
async function start() {
    try {
        setConstraints()
        startButton.disabled = true
        sendFile.disabled =true
        created = true
        console.log('entering start function..')
        const stream0=navigator.mediaDevices.getUserMedia(constraints0)
        .then(gotLocalMediaStream0).catch(handleLocalMediaStreamError)
        const stream =
        await navigator.mediaDevices.getUserMedia(constraints)
        .then(gotLocalMediaStream).catch(handleLocalMediaStreamError)
    } catch (err) {
        console.log("Error on start function",err);
    }
}
//////////////////////////setConstraints()/////////////////////////////////////////////////////////
function setConstraints(){
    if(!videoSelect.checked){
        constraints.video = false        
    }
    if(!audioSelect.checked){        
        constraints.audio= false
    }
    if(!videoSelect.checked && !audioSelect.checked){
        constraints.video = {
            mandatory:{
                minWidth:320,
                maxWidth:320,
                minHeight:180,
                maxHeight:180
            }
        }
        constraints.audio = true
    }
}
//////////////////////////////callAction()////////////////////////////////////////////////////////////
function callAction() {
    isCaller=true
    sendFile.disabled = true
    displaySignalMessage('Starting call.');
    setPc()
    displaySignalMessage('peerConnection createOffer start.');
    rtcPeerConn.createOffer()
    .then(createdOffer).catch(setSessionDescriptionError);            
}
//////////////////////////////setPc()////////////////////////////////////////////////////////////
function setPc() {
    startTime = window.performance.now();
    callButton.disabled = true;
    hangupButton.disabled = false;            
    startTime = window.performance.now();
    // Get local media stream tracks.
    const videoTracks = localStream.getVideoTracks();
    const audioTracks = localStream.getAudioTracks();
    if (videoTracks.length > 0) {
        displaySignalMessage(`Using video device: ${videoTracks[0].label}.`);
    }
    if (audioTracks.length > 0) {
        displaySignalMessage(`Using audio device: ${audioTracks[0].label}.`);
    }
    rtcPeerConn = new webkitRTCPeerConnection(servers);
    displaySignalMessage('Created local peer connection object rtcPeerConn.');
    sendDataChannel = rtcPeerConn.createDataChannel('textMessages',dataChannelOptions)
    //dataChannel.onopen = dataChannelStateChanged;
    rtcPeerConn.ondatachannel = receiveDataChannel;       
    rtcPeerConn.addEventListener('addstream', gotRemoteMediaStream);            
    rtcPeerConn.addStream(localStream);
    displaySignalMessage('Added local stream to rtcPeerConnection.');
    rtcPeerConn.addEventListener('icecandidate', handleConnection);
    rtcPeerConn.addEventListener(
       'iceconnectionstatechange', handleConnectionChange);                   
}
/////////////////////////////////createdOffer()///////////////////////////////////////////////////////
function createdOffer(description) {          
    console.log('offer from this local peer connection: ',description.sdp)
    displaySignalMessage('localPeerConnection setLocalDescription start.');
    rtcPeerConn.setLocalDescription(description)
    .then(() => {
    setLocalDescriptionSuccess(rtcPeerConn);
    console.log('Local description created: ',rtcPeerConn.localDescription)
    displaySignalMessage("Local description created..")
    if(isCaller){
        sendLocalDesc(rtcPeerConn.localDescription)
    }
    //displaySignalMessage(`Local description created: ${rtcPeerConn.localDescription.toString()}`)
    }).catch(setSessionDescriptionError);
}
////////////////////////////////setLocalDescriptionSuccess////////////////////////////////////////////
// Logs success when localDescription is set.
function setLocalDescriptionSuccess(peerConnection) {
    setDescriptionSuccess(peerConnection, 'setLocalDescription');
}
///////////////////////////////setDescriptionSuccess///////////////////////////////////////////////////
// Logs success when setting session description.
function setDescriptionSuccess(peerConnection, functionName) {
    displaySignalMessage(`${functionName} complete.`);
}
////////////////////////////////setSessionDescriptionError/////////////////////////////////////////////
function setSessionDescriptionError(error) {
    displaySignalMessage(`Failed to create session description: ${error.toString()}.`);
}
/////////////////////////////////////handleConnetionChange///////////////////////////////////////////
function handleConnectionChange(event) {
    const peerConnection = event.target;
    console.log('ICE state change event: ', event);
    if(peerConnection.iceConnectionState == "connected") sendFile.disabled = false;
    displaySignalMessage(`ICE state: ` +
            `${peerConnection.iceConnectionState}.`);
}
////////////////////////////function sendLocalDesc/////////////////////////////////////////////////////        
function sendLocalDesc(desc){
    console.log("sending local description",desc);//------------>aqui hay un error entra varias veces, cuando solo ha entrado un usuario mas.
    try{
        displaySignalMessage("16. Sending Local description");
        var sdp = {
            type:"SDP",
            message:JSON.stringify({'sdp':desc}),
            room:SIGNAL_ROOM
        }
        console.log("sdp sent to other nodes in sendLocalDescription: ",sdp)
        io.emit('signal',sdp);
    }catch{
        logError1(e,"sending local description");
    }
}
/////////////////////////////////logError1/////////////////////////////////////////////////////
function logError1(error,where){
    displaySignalMessage("problems in " + where +" "+ error.name + ': ' + error.message );
}
function logError(error){
    displaySignalMessage( error.name + ': ' + error.message );
}
function displayMessage(message){
    chatArea.innerHTML = chatArea.innerHTML + "<br/>" + message; //solo se adjunta el mensaje
}
function displaySignalMessage(message){
    signalingArea.innerHTML = signalingArea.innerHTML + "<br/>" + message; //solo se adjunta el mensaje
}
/////////////////////////////handleConnection////////////////////////////////////////////////////
function handleConnection(event) {
    const peerConnection = event.target;
    const iceCandidate = event.candidate;
    if(iceCandidate){
        icesReq.push(iceCandidate)
    }
    else if (!iceCandidate && icesReq.length>0) {
        var len = icesReq.length
        var iter = 0
        displaySignalMessage("ICE protocol gathered " + len + " candidates.." )
        let newIceCandidate
        icesReq.forEach(iceCandidate=>{
            iter++
            newIceCandidate = iceCandidate;
            console.log("candidate created ready to be sent: ", newIceCandidate);
            io.emit('signal',{
                "type":"ice candidate",
                "message":JSON.stringify({'candidate':newIceCandidate}),
                "room":SIGNAL_ROOM})
            displaySignalMessage( iter +". Sending Ice candidate ...");
        })
        io.emit('signal',{
            "type":"noIce",
            "message":"",
            "room":SIGNAL_ROOM})
        //icesReq = []      
    }else if(!iceCandidate && icesReq.length==0){
        displaySignalMessage("Candidate received is null, no candidates received yet, check your code!..")
    }
}
/////////////////////////////gotLocalMediaStream///////////////////////////////////////////////
function gotLocalMediaStream(mediaStream) {
    //myVideoArea.srcObject = mediaStream;
    localStream = mediaStream;
    displaySignalMessage('Received local stream.');
    callButton.disabled = false
}
/////////////////////////////gotLocalMediaStream0///////////////////////////////////////////////
function gotLocalMediaStream0(mediaStream) {
    myVideoArea.srcObject = mediaStream;        
    displaySignalMessage('Showing my local stream video.');        
}
////////////////////////////handleLocalMediaStreamError///////////////////////////////////////
function handleLocalMediaStreamError(error) {
    displaySignalMessage(`navigator.getUserMedia error: ${error.toString()}.`);
}
////////////////////////////gotRemoteMediaStream///////////////////////////////////////////////
function gotRemoteMediaStream(event) {
    const mediaStream = event.stream;
    theirVideoArea.srcObject = mediaStream;
    displaySignalMessage('Remote peer connection received remote stream.');
}
////////////////////////////hangUpButton()/////////////////////////////////////////////////////
function hangupAction() {
    rtcPeerConn.close()
        if(sendDataChannel){
            sendDataChannel.close()
            sendDataChannel = null
        }
        if(catchDataChannel){
            catchDataChannel.close()
            catchDataChannel = null
        }
        rtcPeerConn = null;
        icesReq = []
        sendFile.disabled = true
        hangupButton.disabled = true;
        callButton.disabled = false;
    io.emit('signal',{"type":"endCall","message":"finishing call","room":SIGNAL_ROOM})
    displaySignalMessage('Ending call.');
}
////////////////////////////logVideoLoaded///////////////////////////////////////////////////////
// Logs a message with the id and size of a video element.
function logVideoLoaded(event) {
    const video = event.target;
    displaySignalMessage(`${video.id} videoWidth: ${video.videoWidth}px, ` +
            `videoHeight: ${video.videoHeight}px.`);
}
/////////////////////////////logResizedVideo//////////////////////////////////////////////////////
// Logs a message with the id and size of a video element.
// This event is fired when video begins streaming.
function logResizedVideo(event) {
    logVideoLoaded(event);
    if (startTime) {
        const elapsedTime = window.performance.now() - startTime;
        startTime = null;
        displaySignalMessage(`Setup time: ${elapsedTime.toFixed(3)}ms.`);
    }
}
//////////////////////////////window//////////////////////////////////////////////////////////////
window.onbeforeunload = function() {
    io.emit('signal',{"type":"endCall","message":"finishing call","room":SIGNAL_ROOM})
};
////////////////////////////dataChannelStateChanged////////////////////////////////////////////////
function dataChannelStateChanged(){
    if(catchDataChannel.readyState === 'open'){//si el readyState es abierto
        displaySignalMessage("Data Channel Opened")
        //dataChannel.onmessage = receiveDataChannelMessage;//me voy a este 
        //event handler para setear que hacer cuando se recible un nuevo mensaje.
    }else{
        displaySignalMessage("data channel is : " + catchDataChannel.readyState)
    }
}
///////////////////////////////receiveDataChannel()////////////////////////////////////////////
function receiveDataChannel(event){
    displaySignalMessage("Receiving a data channel")
    catchDataChannel = event.channel;//seteando el canal de datos a ser el que el 
    //canal que es el que ha sido enviado por nuestro peer.
    //dataChannel.onmessage = receiveDataChannelMessage;//el evento de onmessage que esta
    //almacenado en data channel es manejado por el metodo receiveDataChannelMessage    
    catchDataChannel.onmessage = receiveDataChannelMessage;
    catchDataChannel.onopen = dataChannelStateChanged;
    catchDataChannel.onclose = dataChannelStateChanged;
}
//////////////////////////////receiveDataChannelMessage////////////////////////////////////////
function receiveDataChannelMessage(event){
    //displaySignalMessage("Incoming Message")
    //displayMessage("From data channel: " + event.data);
    //this is where we process incoming files
    fileBuffer.push(event.data) //pushing each chunk of the incoming file
    //into fileBuffer
    fileSize += event.data.byteLength //updating the size of the file    
    fileProgress.value = fileSize //putting the same coount onto the progress bar   
    //displaySignalMessage("Receiving... " + fileSize + "/" + receivedFileSize )
    //provide link to downloadable file when complete
    if(fileSize === receivedFileSize){
        var received = new window.Blob(fileBuffer)
        fileBuffer = []
        displaySignalMessage("clearing fileBuffer..." + "length buffer = "+fileBuffer.length)
        displaySignalMessage("all done... data received")
        downloadLink.href = URL.createObjectURL(received)//finally when all is received
        //the peer will get the link to download de file
        downloadLink.download = receivedFileName
        removeAllChildItems(downloadLink)
        downloadLink.appendChild(document.createTextNode(receivedFileName + "(" + 
        fileSize + ") bytes" ))
        displaySignalMessage("Received... " + fileSize + "/" + receivedFileSize )
        fileSize = 0
    }
}
///////////////////////////////removeAllChildItems()/////////////////////////////////////////////
function removeAllChildItems(element){
    //var ele = document.getElementById(elementId);
    while (element.hasChildNodes()) {
        element.removeChild(element.firstChild);
    }
}