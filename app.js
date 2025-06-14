//Require Packages
const express=require("express");
const app=express();
const path=require("path");
const mongoose=require("mongoose");
const ejsMate=require("ejs-mate");
const flash=require("connect-flash");
const session=require("express-session");
const cookieParser = require('cookie-parser')
const methodOverride=require("method-override");

//node-schedule can schedule the task, but cant iteract with the front-end by itself. So we use socket.io
const schedule = require("node-schedule");

//to send backend request to frontend
const socketIo = require("socket.io");
const http = require("http");
const server = http.createServer(app); // Use HTTP server
const io = socketIo(server); // Initialize socket.io with the server
server.listen(8080);

//Require Schemas
const Test=require("./models/test.js");
const Announcement=require("./models/announcement.js");

const mongoURL='mongodb://127.0.0.1:27017/CDCproject';

//Middlewares
app.use('/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist')));//to use bootstrap
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(express.static(path.join(__dirname,"/public"))); 
app.use(methodOverride("_method"));

const sessionOptions={
    secret:"mysupersecret",
    resave: false,
    saveUninitialized: true,
    cookie:{
        expires:Date.now()+60*60*24*1000*7,
        maxAge:60*60*24*1000*7,
        httpOnly:true
    }
};
app.use(session(sessionOptions));
app.use(flash());
app.use(cookieParser())

app.use((req,res,next)=>{
    res.locals.failure=req.flash("failure");
    next();
});

const checkValidity = async (req,res,next)=>{
    let {id}=req.params;
    let test=await Test.findById(id);
    let currentTime=new Date();
    let {startTime,endTime}=test;
    if(currentTime<startTime){
        req.flash("failure","The test cannot be started!");
        return res.redirect("/");
    }
    else if(currentTime>endTime){
        req.flash("failure","The test is completed!");
        return res.redirect("/");
    }
    else{
        next();
    }
}

app.set("view engine","ejs");
app.set("views",path.join(__dirname,"views"));
app.engine("ejs",ejsMate);

main()
.then(()=>{
    console.log("Connected to DB");
})
.catch((err)=>{
    console.log(err);
});

async function main() {
  await mongoose.connect(mongoURL);
}

const scheduledJobs = new Set(); // store globally, outside route

app.get("/register",(req,res)=>{
    res.render("register_login/register.ejs");
});

app.get("/login",(req,res)=>{
    res.render("register_login/login.ejs");
});

app.get("/", async (req, res) => {
    let allTests = await Test.find({});
    allTests.reverse();
    allTests.forEach((test) => {
        if (!scheduledJobs.has(test._id.toString())) {
            const runAt = new Date(test.startTime);
            schedule.scheduleJob(runAt, () => {
                io.emit("task-complete", {
                    message: `You can start "${test.testName}"`,
                    id: test._id
                });
            });
            scheduledJobs.add(test._id.toString()); // mark as scheduled
        }
    });
    res.render("user/home.ejs", { currentPath: req.path, allTests });
});

app.get("/history",(req,res)=>{
    res.render("user/history.ejs",{ currentPath: req.path });
});

app.get("/announcement",async (req,res)=>{
    let allAnnouncements=await Announcement.find({});
    allAnnouncements.reverse();
    res.render("user/announcement.ejs",{ currentPath: req.path,allAnnouncements });
});

//Show test
app.get("/tests/:id",checkValidity,async (req,res)=>{
    let {id}=req.params;
    let test=await Test.findById(id);
    res.render("question.ejs",{test});
});

//Show submission page
app.get("/submission",(req,res)=>{
    res.send("This is submission page");
});

//Show Test Form 
app.get("/test/new",(req,res)=>{
    res.render("testForm.ejs");
});

// Create Test Route
app.post("/test/questions/new",async (req,res)=>{
    let {testName,date,time,duration,numberOfQues,totalMarks}=req.body;

    // Combine into ISO string
    const isoString = `${date}T${time}:00`;

    // Convert to Date object (for MongoDB)
    const startTime = new Date(isoString);
    const endTime = new Date(isoString);
    endTime.setMinutes(endTime.getMinutes()+Number(duration));

    const newTest=new Test({
        testName,startTime,endTime,duration,numberOfQues,totalMarks
    });

    await newTest.save()
    .then((response)=>{
        const id=response._id;
        res.render("questionForm.ejs",{numberOfQues,id});
    })
    .catch((err)=>console.log(err));
});

//Create Ques Route
app.post("/test/questions/:id",async (req,res)=>{
    const {id}=req.params;
    await Test.findByIdAndUpdate(id,{questions:req.body.questions});
    res.redirect("/dashboard");
})

//Delete Test
app.delete("/test/:id",async (req,res)=>{
    let {id}=req.params;
    await Test.findByIdAndDelete(id);
    res.redirect("/dashboard");
});

//Show Test Edit Form
app.get("/test/:id",async (req,res)=>{
    let {id}=req.params;
    let test=await Test.findById(id);
    res.render("testEditForm.ejs",{id,test});
});

//Update Test
app.put("/test/:id",async (req,res)=>{
    let {id}=req.params;
    let {date,time,duration}=req.body;

    // Combine into ISO string
    const isoString = `${date}T${time}:00`;

    // Convert to Date object (for MongoDB)
    const startTime = new Date(isoString);
    const endTime = new Date(isoString);
    endTime.setMinutes(endTime.getMinutes()+Number(duration));

    await Test.findByIdAndUpdate(id,{...req.body,startTime,endTime});
    res.redirect("/dashboard");
});

// _____________________________________________________________________

//Show Announcement Form
app.get("/announcement/new",(req,res)=>{
    res.render("announcementForm.ejs");
});

//Create Announcement
app.post("/announcement/new",async (req,res)=>{
    let announcement=req.body;
    let now=new Date();
    let date=now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    newAnnouncement=new Announcement({...announcement,date});
    await newAnnouncement.save();
    res.redirect("/dashboard");
})

//Delete Announcement
app.delete("/announcement/:id",async (req,res)=>{
    let {id}=req.params;
    await Announcement.findByIdAndDelete(id);
    res.redirect("/dashboard");
});

//Show Announcement Edit Form
app.get("/announcement/:id",async (req,res)=>{
    let {id}=req.params;
    let announcement=await Announcement.findById(id);
    res.render("announcementEditForm.ejs",{id,announcement});
});

//Update Announcement
app.put("/announcement/:id",async (req,res)=>{
    let {id}=req.params;
    let announcement=await Announcement.findById(id);
    await Announcement.findByIdAndUpdate(id,{...req.body})
    res.redirect("/dashboard");
});

app.get("/dashboard",async (req,res)=>{
    let allAnnouncements=await Announcement.find({});
    allAnnouncements.reverse();
    let allTests = await Test.find({});
    allTests.reverse();
    res.render("dashboard.ejs",{allAnnouncements,allTests});
})

//Error Handler
// app.use((err,req,res,next)=>{
//     let {status=500,message="Sorry! Some error occurred."}=err;
//     res.status(status).render("error.ejs",err);
// });
//.......

// Page not found error as middleware
app.use((req,res)=>{
    res.status(404).send("Page not found")
});

app.listen(8080,()=>{
    console.log("Server is listening at http://localhost:8080");
});