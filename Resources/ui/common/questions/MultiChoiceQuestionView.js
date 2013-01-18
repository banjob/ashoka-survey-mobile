//MultiChoiceQuestionView Component Constructor
var _ = require('lib/underscore')._;
var OptionView = require('ui/common/questions/OptionView');
var SeparatorView = require('ui/common/components/SeparatorView');
var Palette = require('ui/common/components/Palette');
var Response = require('models/response');

function MultiChoiceQuestionView(question, answer, response, number, pageNumber) {

  var optionIDs = answer ? answer.optionIDs() : null;

	var self = Ti.UI.createView({
    layout : 'vertical',
    height : Titanium.UI.SIZE
  });

	var optionViews = {};

	_(question.options()).each(function(option, index) {
		var checked = optionIDs && _(optionIDs).contains(option.id);
		var optionNumber = number + String.fromCharCode(97 + index);
		optionViews[option.id] = new OptionView(option, checked, response, optionNumber, pageNumber);
	});

	_.chain(optionViews).values().each(function(view, index){
		self.add(view);
	});

	self.getValue = function() {
		var option_ids = [];
		_(optionViews).each(function(row, option_id) {
			if (row.children[0].children[0].getValue() === true)
				option_ids.push(option_id);
		});
		if (_(option_ids).isEmpty())
			return "";
		else
			return option_ids;
	};

	return self;
}

module.exports = MultiChoiceQuestionView;
