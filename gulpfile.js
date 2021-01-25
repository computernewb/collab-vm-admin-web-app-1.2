var gulp = require('gulp'),
	concat = require('gulp-concat'),
	inject = require('gulp-inject'),
	htmlmin = require('gulp-htmlmin'),
	uglify = require('gulp-uglify'),
	fs = require('fs');

function JsTask() {
	return gulp.src(['src/js/guacamole/**/*.js', 'src/js/collab-vm/common.js', 'src/js/collab-vm/admin.js'])
		.pipe(concat('admin.min.js'))
		.pipe(uglify())
		.pipe(gulp.dest('build/admin'));    
};

function ResTask() {
	return gulp.src('src/res/**/*',  { dot: true /* Include view/.htaccess */ })
		.pipe(gulp.dest('build'));
};

function HtmlTask() {
	return gulp.src('src/html/admin/*.html')
		.pipe(inject(gulp.src(['build/*.css'], {read: false}), { ignorePath: 'build', addPrefix: '..', addRootSlash: false }))
		.pipe(inject(gulp.src(['build/admin/admin.min.js'], {read: false}), { ignorePath: 'build/admin', addRootSlash: false }))
		.pipe(htmlmin(JSON.parse(fs.readFileSync('html-minifier.conf', 'utf8'))))
		.pipe(gulp.dest('build/admin'));
};

function GuacTask() {
	return gulp.src('src/js/guacamole/*.js')
		.pipe(concat('guacamole.min.js'))
		.pipe(uglify())
		.pipe(gulp.dest('src/html'));
};

exports.guacamole = GuacTask;

exports.default = gulp.series(
    JsTask,
    ResTask,
    HtmlTask
);
