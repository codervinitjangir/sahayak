// Web real map: Leaflet + OpenStreetMap tiles inside an iframe (react-native-maps has no
// web target). Parent and iframe talk through postMessage so React state stays the source
// of truth. Tiles are © OpenStreetMap contributors (attribution shown by Leaflet).
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";

import type { LatLng } from "../../types";
import { useRoute } from "./useRoute";
import type { RealMapProps } from "./RealMap";

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{height:100%;margin:0}.pin{font-size:34px;line-height:34px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))}</style>
</head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('m',{zoomControl:false}).setView([12.9716,77.5946],16);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var user=null,partner=null,radar=null,line=null,lastKey='';
function pin(e){return L.divIcon({className:'',html:'<div class="pin">'+e+'</div>',iconSize:[34,34],iconAnchor:[17,34]});}
window.addEventListener('message',function(ev){
  var s=ev.data; if(!s||s.type!=='state')return;
  var u=[s.user.latitude,s.user.longitude];
  if(!user){user=L.marker(u,{icon:pin('📍'),draggable:false}).addTo(map);
    user.on('dragend',function(){var p=user.getLatLng();parent.postMessage({type:'drag',latitude:p.lat,longitude:p.lng},'*');});}
  user.setLatLng(u); if(user.dragging){s.draggable?user.dragging.enable():user.dragging.disable();}
  if(partner){map.removeLayer(partner);partner=null;}
  if(s.partner){partner=L.marker([s.partner.latitude,s.partner.longitude],{icon:pin('🚗')}).addTo(map);}
  if(radar){map.removeLayer(radar);radar=null;}
  if(s.radar){radar=L.circle(u,{radius:s.radarRadius,color:'#111111',fillColor:'#111111',fillOpacity:.18}).addTo(map);}
  if(line){map.removeLayer(line);line=null;}
  if(s.route&&s.route.length>1){line=L.polyline(s.route.map(function(p){return [p.latitude,p.longitude];}),{color:'#111111',weight:5}).addTo(map);}
  var key=u.join(',')+'|'+(s.partner?'p':'');
  if(key!==lastKey){lastKey=key;
    if(line){map.fitBounds(line.getBounds(),{paddingTopLeft:[40,60],paddingBottomRight:[40,260]});}
    else{map.setView(u,16);map.panBy([0,90],{animate:false});}}
});
parent.postMessage({type:'ready'},'*');
</script></body></html>`;

export default function RealMap({
  userLocation,
  partnerLocation,
  showRoute = false,
  showRadar = false,
  radarRadius = 900,
  draggable = false,
  onUserMarkerDragEnd,
}: RealMapProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const route = useRoute(userLocation, partnerLocation, showRoute);
  const ready = useRef(false);
  const latest = useRef<unknown>(null);

  latest.current = {
    type: "state",
    user: userLocation,
    partner: partnerLocation ?? null,
    route: showRoute ? route : [],
    radar: showRadar,
    radarRadius,
    draggable,
  };

  const push = () => frame.current?.contentWindow?.postMessage(latest.current, "*");

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === "ready") {
        ready.current = true;
        push();
      } else if (e.data?.type === "drag") {
        onUserMarkerDragEnd?.({ latitude: e.data.latitude, longitude: e.data.longitude } as LatLng);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onUserMarkerDragEnd]);

  useEffect(() => {
    if (ready.current) push();
  });

  return (
    <View style={StyleSheet.absoluteFill}>
      {React.createElement("iframe", {
        ref: frame,
        srcDoc: HTML,
        title: "Map",
        style: { border: 0, width: "100%", height: "100%" },
      })}
    </View>
  );
}
