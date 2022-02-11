/* 1. expressモジュールをロードし、インスタンス化してappに代入。*/
import puppeteer from "puppeteer";
import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import xml2js from "xml2js";
import { Client } from "@googlemaps/google-maps-services-js";
import mongoose from "mongoose";
import { Coordinate } from "./models/coordinate.js";
import { countSpaces } from "./modules/util.js";
import { Server } from "socket.io";

dotenv.config();

const mongoDB = process.env.MONGODB_URI; // mongooseのデフォルト接続を設定する
mongoose.connect(mongoDB);
mongoose.Promise = global.Promise; // Mongoose にグローバルプロミスライブラリを使わせる
const db = mongoose.connection; // デフォルトの接続を取得する

// 接続をエラーイベントにバインドする(接続エラーの通知を受ける)
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("DB connection successful"));

const app = express();
app.use(cors());
app.use(express.json()); // body-parser settings

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

server.listen(3001);

/* 3. 以後、アプリケーション固有の処理 */

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const R = Math.PI / 180;
const calcDistance = (lat1, lng1, lat2, lng2) => {
  lat1 *= R;
  lng1 *= R;
  lat2 *= R;
  lng2 *= R;
  return (
    6371 *
    Math.acos(
      Math.cos(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1) +
        Math.sin(lat1) * Math.sin(lat2)
    )
  );
};

// const getLocationByGiaApi = async (address) => {
//   const makeUrl = "https://msearch.gsi.go.jp/address-search/AddressSearch";
//   const encodedURI = encodeURI(`${makeUrl}?q=${address}`);
//   console.log("地理院APIにリクエスト送信");
//   const location_array = await axios
//     .get(encodedURI)
//     .then((response) => response.data[0].geometry.coordinates);
//   return { lng: location_array[0], lat: location_array[1] };
// };

const parseXml = (xml) => {
  return new Promise((resolve, reject) => {
    xml2js.parseString(xml, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result.YDF.Feature[0].Geometry[0].Coordinates[0].split(","));
      }
    });
  });
};

const getLocationByYolp = async (address) => {
  const makeUrl = `https://map.yahooapis.jp/geocode/V1/geoCoder?appid=${process.env.YOLP_API_KEY}`;
  const encodedURI = encodeURI(`${makeUrl}&query=${address}`);
  // console.log("YOLPにリクエスト送信");
  const location_array = await axios
    .get(encodedURI)
    .then((response) => parseXml(response.data));

  return { lng: Number(location_array[0]), lat: Number(location_array[1]) };
};

const client = new Client({});
const getLocationByGoogleMaps = async (address) => {
  const res = await client
    .geocode({
      params: {
        address,
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
      timeout: 1000, // milliseconds
    })
    .then((res) => {
      return res;
    })
    .catch((e) => {
      console.log(e.response.data.error_message);
    });

  const placeId = res.data.results[0].place_id;
  const formattedAddress = res.data.results[0].formatted_address;
  const location = res.data.results[0].geometry.location;

  return location;
};

app.post("/api/mapping", async (req, res, next) => {
  if (Object.keys(req.body).length === 0) {
    res.status(200);
    return;
  }
  const startTime = performance.now(); // 開始時間

  const url = req.body.url;
  const centerAddress = req.body.centerAddress;
  const distance_string = req.body.distance;
  const socketId = req.body.socketId;

  const centerLocation = await getLocationByYolp(centerAddress);
  const distance = Number(distance_string);

  const options = {
    headless: true,
  };
  const browser = await puppeteer.launch(options);
  const page = await browser.newPage();

  const userAgent =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36";
  page.setUserAgent(userAgent);

  page.setDefaultNavigationTimeout(0);
  await page.goto(url);
  await sleep(3000);

  const getTextContentFromElemHandler = async (elementHandle) => {
    const textContentProperty = await elementHandle.getProperty("textContent");
    return textContentProperty.jsonValue();
  };

  const getHrefFromElemHandler = async (elementHandle) => {
    const hrefProperty = await elementHandle.getProperty("href");
    return hrefProperty.jsonValue();
  };

  const getSrcFromElemHandler = async (elementHandle) => {
    const srcProperty = await elementHandle.getProperty("src");
    return srcProperty.jsonValue();
  };

  // トータルのページ数を取得する
  const navigationElemHandlers = await page.$$("ol.pagination-parts > li > a");
  const totalPageLength = await getTextContentFromElemHandler(
    navigationElemHandlers[navigationElemHandlers.length - 1]
  );
  // for (const elem of navigationElemHandlers) {
  //   console.log(totalPageLength);
  // }

  const extractInfoFromSinglePage = async (page) => {
    const elems = await page.$$("ul.l-cassetteitem > li");

    const propertyInfosWithNull = await Promise.all(
      elems.map(async (elem) => {
        // TODO: 複数の部屋の表示に対応する
        const trs = await elem.$$(".cassetteitem_other > tbody > tr");
        const tds = await trs[0].$$("td");

        // 階数
        const stairs = await getTextContentFromElemHandler(tds[2]);

        // 詳細リンク
        const detailUrlElemHandler = await tds[tds.length - 1].$("a");
        const detailUrl = await getHrefFromElemHandler(detailUrlElemHandler);

        // 画像URL
        let imgSrc = "";
        try {
          const imgElemHandler = await elem.$(".js-linkImage");
          imgSrc = await getSrcFromElemHandler(imgElemHandler);
        } catch (error) {
          imgSrc = "";
        }

        // タイトル
        const titleElemHandler = await elem.$("div.cassetteitem_content-title");
        const title = await getTextContentFromElemHandler(titleElemHandler);

        if (countSpaces(title) > 1) {
          console.log(`不正なタイトル: ${title}`);
          return null;
        }

        // 住所
        const addressElemHandler = await elem.$(".cassetteitem_detail-col1");
        const address = await getTextContentFromElemHandler(addressElemHandler);

        // 賃料
        const rentElemHandler = await elem.$(".cassetteitem_other-emphasis");
        const rent = await getTextContentFromElemHandler(rentElemHandler);

        // 管理費
        const administrativeExpensesElemHandler = await elem.$(
          ".cassetteitem_price--administration"
        );
        const administrativeExpenses = await getTextContentFromElemHandler(
          administrativeExpensesElemHandler
        );

        // 敷金
        const depositElemHandler = await elem.$(".cassetteitem_price--deposit");
        const deposit = await getTextContentFromElemHandler(depositElemHandler);

        // 保証金
        const gratuityElemHandler = await elem.$(
          ".cassetteitem_price--gratuity"
        );
        const gratuity = await getTextContentFromElemHandler(
          gratuityElemHandler
        );

        // 間取り
        const planOfHouseElemHandler = await elem.$(".cassetteitem_madori");
        const planOfHouse = await getTextContentFromElemHandler(
          planOfHouseElemHandler
        );

        // 面積
        const areaElemHandler = await elem.$(".cassetteitem_menseki");
        const area = await getTextContentFromElemHandler(areaElemHandler);

        const addressAndBuildingName = `${address}${title}`;
        let location = {};
        // mongodbに問い合わせる
        const found_coordinate = await Coordinate.find({
          address: addressAndBuildingName,
        });
        if (found_coordinate.length > 0) {
          location = {
            lng: found_coordinate[0].lng,
            lat: found_coordinate[0].lat,
          };
        } else {
          // 座標
          location = await getLocationByGoogleMaps(addressAndBuildingName);
          console.log("Google Map APIを使用");
          // mongodbに保存
          const coordinate = new Coordinate({
            address: addressAndBuildingName,
            lng: location.lng,
            lat: location.lat,
          });
          await coordinate.save();
        }

        if (
          calcDistance(
            centerLocation.lat,
            centerLocation.lng,
            location.lat,
            location.lng
          ) *
            1000 <
          distance
        ) {
          return {
            stairs,
            detailUrl,
            imgSrc,
            title,
            address,
            location,
            rent,
            administrativeExpenses,
            deposit,
            gratuity,
            planOfHouse,
            area,
          };
        } else return null;
      })
    );
    console.log(`物件数: ${elems.length}件 `);
    const propertyInfos = propertyInfosWithNull.filter((item) => item);

    // 次へボタンを探す
    const navigationElemHandlers = await page.$$("p.pagination-parts > a");
    let nextElemHandler = null;
    for await (const navElemHandler of navigationElemHandlers) {
      const text = await getTextContentFromElemHandler(navElemHandler);
      if (text === "次へ") {
        nextElemHandler = navElemHandler;
      }
    }

    return [propertyInfos, nextElemHandler];
  };

  let propertyInfos = [];
  let currentPageNum = 1;
  while (true) {
    // 現在のページから物件情報を抽出する
    console.log(`${currentPageNum}ページ: 物件情報を抽出する`);
    const [propertyInfosPerPage, nextElemHandler] =
      await extractInfoFromSinglePage(page);
    propertyInfos = [...propertyInfos, ...propertyInfosPerPage];
    io.to(socketId).emit(
      "progress",
      (currentPageNum * 100) / Number(totalPageLength)
    );
    if (nextElemHandler) {
      console.log("次へをクリック");
      let div_selector_to_remove = "#js-bannerPanel";
      await page.evaluate((sel) => {
        const elements = document.querySelectorAll(sel);
        console.log(`elements: ${elements.length}`);
        elements.forEach((element) => element.parentNode.removeChild(element));
      }, div_selector_to_remove);
      nextElemHandler.click();
      currentPageNum += 1;
      // https://qiita.com/monaka_ben_mezd/items/4cb6191458b2d7af0cf7
      await page.waitForNavigation({ waitUntil: ["load", "networkidle2"] });
      // await sleep(5000);
    } else break;
  }

  const endTime = performance.now(); // 終了時間
  console.log((endTime - startTime) / 1000, " [s]"); // 何ミリ秒かかったかを表示する

  await browser.close();

  res.status(200).send({
    data: propertyInfos,
  });
});
