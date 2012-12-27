var _ = require('lib/underscore')._;
var Question = require('models/question');
var QuestionView = require('ui/common/questions/QuestionView');
var SeparatorView = require('ui/common/components/SeparatorView');
var Palette = require('ui/common/components/Palette');
var Measurements = require('ui/common/components/Measurements');

function ResponseViewHelper() {
  var self = {};
  var PAGE_SIZE = 7;

  var footerView = function() {
    return Ti.UI.createLabel({
      text : "<< Swipe to turn pages >>",
      textAlign : Ti.UI.TEXT_ALIGNMENT_CENTER,
      color : Palette.SECONDARY_COLOR_LIGHT,
      backgroundColor : Palette.PRIMARY_COLOR,
      height : '40dip',
      font : {
        fontSize : Measurements.FONT_MEDIUM      },
      width : '100%'
    });
  };

  self.resetErrors = function(questionViews) {
    _(questionViews).each(function(questionView) {
      questionView.resetError();
    });
  };

  self.displayErrors = function(responseErrors, questionViews) {
    self.resetErrors(questionViews);
    Ti.API.info("All the errors:" + responseErrors);
    for (var answerErrors in responseErrors) {
      Ti.API.info("Answer errors for:" + answerErrors);
      for (var field in responseErrors[answerErrors]) {
        var question_id = answerErrors;
        var question = Question.findOneById(question_id);
        questionViews[question_id].setError(responseErrors[question_id][field]);
        Ti.API.info(responseErrors[question_id][field]);
      }
    }
  };

  self.getQuestionViews = function(parent) {
    var foo = {};
    if (_(parent).isArray()) {
      var views = _.chain(parent).map(function(scrollView) {
        return scrollView.children;
      }).flatten().value();
    } else {
      var views = parent.getChildren() || [];
    }
    _(views).each(function(view) {
      if (view.type == 'question') {
        foo[view.id] = view;
        Ti.API.info("label and value" + _(view.children).first() + _(view.children).last());
      }
      _(foo).extend(self.getQuestionViews(view));
    });
    return foo;
  };

  var groupQuestionsByPage = function(questions) {
    var pages = [];
    var currentPage = 0;

    _(questions).each(function(question, index) {
      //Put categories on their own page. Don't do it if the very first question is a category.
      if(question.type === undefined && index > 0) {
        currentPage++;
      }

      pages[currentPage] = pages[currentPage] || [];
      pages[currentPage].push(question);

      //Page break after a category as well
      if(question.type === undefined) {
        currentPage++;
      }
      else if(pages[currentPage].length == PAGE_SIZE) {
        currentPage++;
      }
    });

    return pages;
  };

  self.paginate = function(questions, scrollableView, buttons, response) {

     var pagedQuestions = groupQuestionsByPage(questions);

    _(pagedQuestions).each(function(questions, pageNumber) {
      var questionsView = Ti.UI.createScrollView({
        layout : 'vertical'
      });

      _(questions).each(function(question, number) {
        var answer = response ? response.answerForQuestion(question.id) : undefined;
        var questionView = new QuestionView(question, answer, response, number + 1);
        questionsView.add(questionView);
      });
      if (pageNumber + 1 === pagedQuestions.length) {
        questionsView.add(new SeparatorView(Palette.SECONDARY_COLOR_LIGHT, Measurements.PADDING_SMALL));
        _(buttons).each(function(button) {
          questionsView.add(new SeparatorView(Palette.SECONDARY_COLOR_LIGHT, Measurements.PADDING_SMALL));
          questionsView.add(button);
        });
      } else {
        questionsView.add(new SeparatorView(Palette.SECONDARY_COLOR_LIGHT, Measurements.PADDING_SMALL));
        questionsView.add(footerView());
      }
      scrollableView.addView(questionsView);
    });
  };

  self.scrollToFirstErrorPage = function(scrollableView, errors) {
    var views = scrollableView.getViews();
    scrollableView.scrollToView(views[0]);
  };

  return self;
};

module.exports = ResponseViewHelper;
